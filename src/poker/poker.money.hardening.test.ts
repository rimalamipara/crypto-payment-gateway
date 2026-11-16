/**
 * Unit-level tests for F-01 money hardening helpers (claim + credit up-to-target).
 * Real-DB parallel refund covered in poker.money.e2e.test.ts when DATABASE_URL is set.
 */
import { describe, expect, it } from "vitest";

import { POKER_HAND_STATUS } from "./poker.constants.ts";

describe("F-01 money hardening constants", () => {
  it("defines cancelling and settling claim statuses", () => {
    expect(POKER_HAND_STATUS.CANCELLING).toBe("cancelling");
    expect(POKER_HAND_STATUS.SETTLING).toBe("settling");
    expect(POKER_HAND_STATUS.ACTIVE).toBe("active");
    expect(POKER_HAND_STATUS.CANCELLED).toBe("cancelled");
    expect(POKER_HAND_STATUS.COMPLETED).toBe("completed");
  });
});
