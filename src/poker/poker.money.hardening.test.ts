/**
 * Unit-level tests for F-01 money hardening helpers.
 *
 * Real-DB cases in poker.money.e2e.test.ts (requires DATABASE_URL):
 * - (a) "restart during settlement must not double-pay (hardening #2)"
 * - (b) "parallel orphan refund: each wallet credited once (hardening #1)"
 * - (c) "server restart mid-hand: reserves returned exactly once"
 *
 * Concurrent xact-lock behaviour: poker.orphan-sweep.test.ts
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
