import { describe, expect, it } from "vitest";

import {
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateSecret,
  totp,
  verifyTotp,
} from "./totp.ts";

describe("totp", () => {
  // RFC 6238 test vector: secret "12345678901234567890", T=59s -> 94287082 (8 digits)
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 6238 vector", () => {
    expect(totp(rfcSecret, 59_000, 8)).toBe("94287082");
  });

  it("verifies within one step and rejects outside / malformed", () => {
    const s = generateSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, "abc", now)).toBe(false);
  });

  it("round-trips encrypted secrets and fails on wrong key", () => {
    const s = generateSecret();
    expect(decryptSecret(encryptSecret(s, "k1"), "k1")).toBe(s);
    expect(() => decryptSecret(encryptSecret(s, "k1"), "k2")).toThrow();
  });
});
