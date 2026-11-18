import {
  createDecipheriv,
  createECDH,
  hkdfSync,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ResponseCryptoService, type SealedPayload } from "./response-crypto.service.ts";
import { secureTransport } from "./secure-transport.middleware.ts";

function service(privateKey?: string) {
  const svc = new ResponseCryptoService({ get: () => privateKey } as never);
  svc.onModuleInit();
  return svc;
}

/** A client that independently derives the key, the way the browser does. */
function client() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64"),
    open(serverPublicKey: string, sealed: SealedPayload, aad: string): unknown {
      const secret = ecdh.computeSecret(Buffer.from(serverPublicKey, "base64"));
      const key = Buffer.from(
        hkdfSync("sha256", secret, Buffer.from("vaultboard-enc-v1"), Buffer.from("response-key"), 32),
      );
      const ct = Buffer.from(sealed.ct, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]);
      return JSON.parse(plain.toString("utf8"));
    },
  };
}

describe("ResponseCryptoService", () => {
  it("encrypts so that only the key holder can decrypt, and never leaks the plaintext", () => {
    const svc = service();
    const c = client();
    const sealed = svc.seal(c.publicKey, { balanceUsd: "1284.50" }, "GET /wallet");
    expect(JSON.stringify(sealed)).not.toContain("1284");
    expect(c.open(svc.publicKey(), sealed, "GET /wallet")).toEqual({ balanceUsd: "1284.50" });
  });

  it("rejects a response replayed under a different request (AAD) or tampered with", () => {
    const svc = service();
    const c = client();
    const sealed = svc.seal(c.publicKey, { a: 1 }, "GET /wallet");
    expect(() => c.open(svc.publicKey(), sealed, "GET /payments")).toThrow();
    const flipped = { ...sealed, ct: Buffer.from(sealed.ct, "base64").map((b, i) => (i === 0 ? b ^ 1 : b)).toString("base64") };
    expect(() => c.open(svc.publicKey(), flipped, "GET /wallet")).toThrow();
  });

  it("another client's key cannot read it", () => {
    const svc = service();
    const alice = client();
    const mallory = client();
    const sealed = svc.seal(alice.publicKey, { secret: true }, "GET /x");
    expect(() => mallory.open(svc.publicKey(), sealed, "GET /x")).toThrow();
  });

  it("rejects malformed client keys", () => {
    const svc = service();
    expect(() => svc.seal("AAAA", {}, "GET /x")).toThrow();
    expect(() => svc.seal(Buffer.alloc(65, 1).toString("base64"), {}, "GET /x")).toThrow();
  });

  it("uses a stable key when RESPONSE_ENC_PRIVATE_KEY is set, and refuses a bad one", () => {
    const k = Buffer.alloc(32, 9).toString("base64");
    expect(service(k).publicKey()).toBe(service(k).publicKey());
    expect(() => service("c2hvcnQ=")).toThrow(/32 bytes/);
  });

  it("seals websocket payloads only for sockets that sent a key", () => {
    const svc = service();
    const c = client();
    const sealed = svc.sealForSocket({ handshake: { auth: { clientKey: c.publicKey } } }, "table_state", { cards: ["As"] }) as SealedPayload;
    expect(c.open(svc.publicKey(), sealed, "ws:table_state")).toEqual({ cards: ["As"] });
    expect(svc.sealForSocket({ handshake: { auth: {} } }, "table_state", { cards: ["As"] })).toEqual({ cards: ["As"] });
  });
});

describe("secureTransport middleware", () => {
  function run(opts: { path: string; method?: string; key?: string; status?: number; body?: unknown }) {
    const svc = service();
    const headers: Record<string, string> = {};
    const sent: unknown[] = [];
    const res = {
      statusCode: opts.status ?? 200,
      setHeader: (k: string, v: string) => void (headers[k] = v),
      json(b: unknown) {
        sent.push(b);
        return this;
      },
    };
    const req = {
      originalUrl: opts.path,
      method: opts.method ?? "GET",
      headers: opts.key ? { "x-client-key": opts.key } : {},
      secure: false,
    };
    const next = vi.fn();
    secureTransport(svc)(req as never, res as never, next);
    res.json(opts.body ?? { ok: 1 });
    return { svc, headers, sent: sent[0], next };
  }

  it("encrypts successful JSON when a client key is present", () => {
    const c = client();
    const r = run({ path: "/wallet?x=1", key: c.publicKey });
    expect(r.next).toHaveBeenCalled();
    expect(r.headers["X-Encrypted"]).toBe("1");
    expect(c.open(r.svc.publicKey(), r.sent as SealedPayload, "GET /wallet")).toEqual({ ok: 1 });
  });

  it("leaves JSON plain without a client key, but still sets safety headers", () => {
    const r = run({ path: "/wallet" });
    expect(r.sent).toEqual({ ok: 1 });
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("never encrypts errors, webhooks, docs or the key endpoint", () => {
    const c = client();
    expect(run({ path: "/wallet", key: c.publicKey, status: 400, body: { message: "Bad" } }).sent).toEqual({ message: "Bad" });
    expect(run({ path: "/payments/webhook", key: c.publicKey }).sent).toEqual({ ok: 1 });
    expect(run({ path: "/docs-json", key: c.publicKey }).sent).toEqual({ ok: 1 });
    expect(run({ path: "/crypto/public-key", key: c.publicKey }).sent).toEqual({ ok: 1 });
  });

  it("falls back to plain JSON for an invalid client key instead of failing", () => {
    expect(run({ path: "/wallet", key: "AAAA" }).sent).toEqual({ ok: 1 });
  });
});
