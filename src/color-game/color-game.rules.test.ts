import { describe, expect, it } from "vitest";

import {
  isValidDuration,
  lockMs,
  pickProfitMaximizingResult,
} from "./color-game.rules.ts";

describe("pickProfitMaximizingResult", () => {
  it("picks the digit with highest house P/L when admin leaves unset", () => {
    // Heavy number bets on 7 → any other digit pays less to players.
    const bets = [
      { betType: "number", selection: "7", amountUsd: "10" },
      { betType: "number", selection: "7", amountUsd: "5" },
    ];
    const pick = pickProfitMaximizingResult(bets, () => 0);
    expect(pick).not.toBe(7);
    // All non-7 digits have same house P/L; first in list with randomPick→0
    expect(pick).toBe(0);
  });

  it("among losing digits picks the lowest house loss", () => {
    // Violet + red stakes that hurt some digits more than others.
    const bets = [
      { betType: "color", selection: "violet", amountUsd: "100" },
      { betType: "color", selection: "red", amountUsd: "10" },
    ];
    const pick = pickProfitMaximizingResult(bets, () => 0);
    // Violet hits on 0 and 5 (expensive). Avoid those for max house P/L.
    expect([0, 5]).not.toContain(pick);
  });

  it("random when no bets", () => {
    expect(pickProfitMaximizingResult([], () => 3)).toBe(3);
  });
});

describe("session durations", () => {
  it("accepts 1/3/5/10 minutes only", () => {
    for (const s of [60, 180, 300, 600]) expect(isValidDuration(s)).toBe(true);
    for (const s of [0, 30, 120, 3600]) expect(isValidDuration(s)).toBe(false);
  });

  it("locks the last 10s of a 1-minute round and 30s of longer ones", () => {
    expect(lockMs(60)).toBe(10_000);
    expect(lockMs(180)).toBe(30_000);
    expect(lockMs(600)).toBe(30_000);
  });
});
