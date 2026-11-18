import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
  type ECDH,
} from "node:crypto";

/**
 * Encrypted envelope sent instead of the plain JSON body.
 * `ct` is AES-256-GCM ciphertext with the 16-byte auth tag appended.
 */
export type SealedPayload = { enc: 1; iv: string; ct: string };

const HKDF_SALT = Buffer.from("vaultboard-enc-v1");
const HKDF_INFO = Buffer.from("response-key");
const KEY_CACHE_MAX = 2000;

/**
 * Response encryption for the browser Network tab.
 *
 * ECDH (P-256) key agreement: the server has one long-lived key pair, and each
 * browser generates its own pair per page load and sends only its public key
 * (`X-Client-Key`). Both sides derive the same AES key, so no key is ever sent.
 * The server public key is fetched from `GET /crypto/public-key`.
 *
 * The server private key comes from RESPONSE_ENC_PRIVATE_KEY (base64, 32 bytes).
 * Without it a key is generated at boot; clients then re-fetch the public key
 * after each restart, so it still works, but set the variable for a stable key.
 *
 * This hides payloads from anyone watching the wire or the Network tab. It does
 * not stop the logged-in user's own browser from reading its own data (the
 * browser must decrypt it to show it). Use TLS for transport security.
 */
@Injectable()
export class ResponseCryptoService implements OnModuleInit {
  private readonly logger = new Logger(ResponseCryptoService.name);
  private readonly ecdh: ECDH = createECDH("prime256v1");
  private readonly keys = new Map<string, Buffer>();

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onModuleInit(): void {
    const configured = this.config.get<string>("RESPONSE_ENC_PRIVATE_KEY")?.trim();
    if (configured) {
      const raw = Buffer.from(configured, "base64");
      if (raw.length !== 32) {
        throw new Error(
          "RESPONSE_ENC_PRIVATE_KEY must be 32 bytes, base64 encoded (see .env.example)",
        );
      }
      this.ecdh.setPrivateKey(raw);
    } else {
      this.ecdh.generateKeys();
      this.logger.warn(
        "RESPONSE_ENC_PRIVATE_KEY is not set: using a temporary key that changes on every restart. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      );
    }
    this.logger.log(
      `Response-encryption public key (pin it in the frontends as VITE_SERVER_ENC_PUBLIC_KEY): ${this.publicKey()}`,
    );
  }

  /** Server public key, uncompressed (65 bytes), base64. Safe to publish. */
  publicKey(): string {
    return this.ecdh.getPublicKey().toString("base64");
  }

  private deriveKey(clientKeyB64: string): Buffer {
    const cached = this.keys.get(clientKeyB64);
    if (cached) return cached;
    const clientPub = Buffer.from(clientKeyB64, "base64");
    if (clientPub.length !== 65 || clientPub[0] !== 4) {
      throw new Error("Invalid client key");
    }
    // Throws if the point is not on the curve.
    const secret = this.ecdh.computeSecret(clientPub);
    const key = Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
    if (this.keys.size >= KEY_CACHE_MAX) this.keys.clear();
    this.keys.set(clientKeyB64, key);
    return key;
  }

  /**
   * Encrypt `value` (JSON) for the client that owns `clientKeyB64`.
   * `aad` is authenticated, not secret: it binds the ciphertext to its request
   * (e.g. "GET /wallet") so a response cannot be swapped for another one.
   */
  seal(clientKeyB64: string, value: unknown, aad: string): SealedPayload {
    const key = this.deriveKey(clientKeyB64);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return { enc: 1, iv: iv.toString("base64"), ct: ct.toString("base64") };
  }

  /**
   * Seal a websocket payload for the socket's own key (sent in the handshake as
   * `auth.clientKey`). Returns the payload unchanged if the client sent no key.
   */
  sealForSocket(
    client: { handshake?: { auth?: { clientKey?: unknown } } },
    event: string,
    payload: unknown,
  ): unknown {
    const key = client.handshake?.auth?.clientKey;
    if (typeof key !== "string" || key.length === 0) return payload;
    try {
      return this.seal(key, payload, `ws:${event}`);
    } catch {
      return payload;
    }
  }
}
