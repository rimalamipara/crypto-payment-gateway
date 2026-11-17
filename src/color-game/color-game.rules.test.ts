import { describe, expect, it } from "vitest";

import { pickProfitMaximizingResult } from "./color-game.rules.ts";

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
