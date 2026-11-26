import { describe, expect, it } from "vitest";

import { depositBlockReason, PERMANENT_EXCLUSION, playBlockReason, type RgSettings } from "./rg.rules.ts";

const now = new Date("2026-11-27T12:00:00Z");
const none: RgSettings = {
  dailyDepositLimitUsd: null,
  dailyLossLimitUsd: null,
  coolingOffUntil: null,
  selfExcludedUntil: null,
};

describe("playBlockReason", () => {
  it("allows with no restrictions", () => {
    expect(playBlockReason(none, 1000, now)).toBeNull();
  });
  it("blocks while self-excluded or cooling off, allows once expired", () => {
    const future = new Date("2026-12-01T00:00:00Z");
    const past = new Date("2026-11-01T00:00:00Z");
    expect(playBlockReason({ ...none, selfExcludedUntil: future }, 0, now)).toMatch(/self-excluded/);
    expect(playBlockReason({ ...none, selfExcludedUntil: PERMANENT_EXCLUSION }, 0, now)).toMatch(/permanently/);
    expect(playBlockReason({ ...none, coolingOffUntil: future }, 0, now)).toMatch(/Cooling-off/);
    expect(playBlockReason({ ...none, coolingOffUntil: past, selfExcludedUntil: past }, 0, now)).toBeNull();
  });
  it("blocks once the loss limit is reached", () => {
    const s = { ...none, dailyLossLimitUsd: 50 };
    expect(playBlockReason(s, 49.99, now)).toBeNull();
    expect(playBlockReason(s, 50, now)).toMatch(/loss limit/);
  });
});

describe("depositBlockReason", () => {
  it("enforces the daily deposit limit including the new amount", () => {
    const s = { ...none, dailyDepositLimitUsd: 100 };
    expect(depositBlockReason(s, 60, 40, now)).toBeNull();
    expect(depositBlockReason(s, 60, 40.01, now)).toMatch(/deposit limit/);
  });
});
