import { describe, expect, it } from "vitest";

import { isAdult } from "./kyc.rules.ts";

describe("isAdult", () => {
  const now = new Date("2026-11-27T00:00:00Z");
  it("accepts exactly 18 and older", () => {
    expect(isAdult("2008-11-27", now)).toBe(true);
    expect(isAdult("1990-01-01", now)).toBe(true);
  });
  it("rejects under 18, future and invalid dates", () => {
    expect(isAdult("2008-11-28", now)).toBe(false);
    expect(isAdult("2030-01-01", now)).toBe(false);
    expect(isAdult("2000-02-31", now)).toBe(false);
  });
});
