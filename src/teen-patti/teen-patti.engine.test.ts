import { describe, expect, it } from "vitest";

import {
  TP_MAX_BLINDS,
  applyAction,
  compareHands,
  legalActions,
  maxStakeFor,
  potLimitFor,
  publicPlayerView,
  scoreHand,
  startHand,
  timeoutAction,
  type TeenPattiActionType,
  type TeenPattiHandState,
} from "./teen-patti.engine.ts";

const hand = (...c: string[]) => scoreHand(c);
const beats = (a: string[], b: string[]) => compareHands(scoreHand(a), scoreHand(b)) > 0;

/** A hand with fixed cards so tests are deterministic. */
function game(opts: {
  boot?: number;
  stacks: number[];
  cards?: string[][];
  seats?: number[];
}): TeenPattiHandState {
  const boot = opts.boot ?? 10;
  const seats = opts.seats ?? opts.stacks.map((_, i) => i);
  const s = startHand({
    handId: 1,
    handNo: 1,
    boot,
    seats: opts.stacks.map((stack, i) => ({ userId: i + 1, seatIndex: seats[i]!, stack })),
    dealerSeat: seats[seats.length - 1]!, // first to act = lowest seat
  });
  if (opts.cards) s.players.forEach((p, i) => (p.cards = opts.cards![i]!));
  return s;
}

function act(s: TeenPattiHandState, userId: number, action: TeenPattiActionType) {
  const r = applyAction(s, userId, action);
  if (!r.ok) throw new Error(`${action} by ${userId}: ${r.error}`);
  return r;
}

/** Money on the table. After a hand ends the pot has been paid into stacks. */
const total = (s: TeenPattiHandState, over = false) =>
  Math.round(((over ? 0 : s.pot) + s.players.reduce((n, p) => n + p.stack, 0)) * 100) / 100;

describe("hand ranking (Octro classic)", () => {
  it("orders the categories trail > pure sequence > sequence > color > pair > high card", () => {
    const ladder = [
      ["2h", "2d", "2c"], // trail
      ["4h", "3h", "2h"], // pure sequence
      ["4h", "3d", "2c"], // sequence
      ["Ah", "9h", "3h"], // color
      ["Ah", "Ad", "3c"], // pair
      ["Ah", "Kd", "9c"], // high card
    ];
    for (let i = 0; i < ladder.length - 1; i += 1) {
      expect(beats(ladder[i]!, ladder[i + 1]!)).toBe(true);
    }
  });

  it("A-K-Q is the highest sequence and A-2-3 is the second highest", () => {
    expect(beats(["Ah", "Kd", "Qc"], ["Ah", "2d", "3c"])).toBe(true);
    expect(beats(["Ah", "2d", "3c"], ["Kh", "Qd", "Jc"])).toBe(true);
    expect(beats(["Kh", "Qd", "Jc"], ["Qh", "Jd", "Tc"])).toBe(true);
    // lowest run is 4-3-2, and it still beats a color
    expect(beats(["4h", "3d", "2c"], ["Ah", "Kh", "9h"])).toBe(true);
    expect(beats(["5h", "4d", "3c"], ["4h", "3d", "2c"])).toBe(true);
  });

  it("applies the same order to pure sequences", () => {
    expect(beats(["Ah", "Kh", "Qh"], ["Ah", "2h", "3h"])).toBe(true);
    expect(beats(["Ah", "2h", "3h"], ["Kh", "Qh", "Jh"])).toBe(true);
  });

  it("does not let K-A-2 wrap around", () => {
    expect(hand("Kh", "Ad", "2c").name).toBe("High Card");
  });

  it("breaks ties by the highest card, then the next, for colors and high cards", () => {
    expect(beats(["Ah", "9h", "3h"], ["Ad", "8d", "7d"])).toBe(true);
    expect(beats(["Ah", "Kd", "9c"], ["Ad", "Kc", "8h"])).toBe(true);
  });

  it("compares pairs by the pair, then the odd card; trails by rank", () => {
    expect(beats(["Kh", "Kd", "2c"], ["Qh", "Qd", "Ac"])).toBe(true);
    expect(beats(["Kh", "Kd", "9c"], ["Kc", "Ks", "8c"])).toBe(true);
    expect(beats(["Ah", "Ad", "Ac"], ["Kh", "Kd", "Kc"])).toBe(true);
    expect(beats(["3h", "3d", "3c"], ["2h", "2d", "2s"])).toBe(true);
  });

  it("treats identical-strength hands as a tie", () => {
    expect(compareHands(hand("Ah", "9d", "3c"), hand("As", "9c", "3h"))).toBe(0);
  });
});

describe("blind play and seeing cards", () => {
  it("hides your own cards until you see them", () => {
    const s = game({ stacks: [500, 500, 500] });
    const me = s.players[0]!;
    expect(publicPlayerView(me, me.userId, false).cards).toBeNull();
    me.hasSeen = true;
    expect(publicPlayerView(me, me.userId, false).cards).toEqual(me.cards);
    // never other players' cards, seen or not
    s.players[1]!.hasSeen = true;
    expect(publicPlayerView(s.players[1]!, me.userId, false).cards).toBeNull();
    // everyone's cards at the end of the hand
    expect(publicPlayerView(s.players[1]!, me.userId, true).cards).toEqual(s.players[1]!.cards);
  });

  it("seeing is free and does not use up your turn", () => {
    const s = game({ stacks: [500, 500, 500] });
    const before = { pot: s.pot, stack: s.players[0]!.stack, seat: s.actingSeat };
    act(s, 1, "see");
    expect(s.players[0]!.hasSeen).toBe(true);
    expect(s.pot).toBe(before.pot);
    expect(s.players[0]!.stack).toBe(before.stack);
    expect(s.actingSeat).toBe(before.seat); // still player 1's turn
    expect(legalActions(s, 1).actions).toContain("chaal");
    expect(legalActions(s, 1).actions).not.toContain("see");
    expect(legalActions(s, 1).actions).not.toContain("blind");
  });
});

describe("bet sizes and the stake", () => {
  it("blind pays the stake, seen pays double", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    expect(legalActions(s, 1).callAmount).toBe(10);
    act(s, 1, "see");
    expect(legalActions(s, 1).callAmount).toBe(20);
    expect(legalActions(s, 1).raiseAmount).toBe(40);
  });

  it("a blind raise pays 2× and doubles the stake", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    act(s, 1, "raise");
    expect(s.players[0]!.totalBet).toBe(10 + 20);
    expect(s.currentStake).toBe(20);
    expect(legalActions(s, 2).callAmount).toBe(20); // next blind player pays the new stake
  });

  it("a seen raise pays 4× and doubles the stake", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    act(s, 1, "see");
    act(s, 1, "raise");
    expect(s.players[0]!.totalBet).toBe(10 + 40);
    expect(s.currentStake).toBe(20);
  });

  it("a plain blind or chaal leaves the stake unchanged", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    act(s, 1, "blind");
    expect(s.currentStake).toBe(10);
    act(s, 2, "see");
    act(s, 2, "chaal");
    expect(s.currentStake).toBe(10);
  });

  it("stops offering a raise once the stake would pass the maximum chaal", () => {
    const s = game({ boot: 2, stacks: [100000, 100000, 100000] });
    s.currentStake = maxStakeFor(2); // 128: a seen chaal costs 256, the Octro maximum
    expect(legalActions(s, 1).actions).not.toContain("raise");
    s.currentStake = maxStakeFor(2) / 2;
    expect(legalActions(s, 1).actions).toContain("raise");
  });

  it("matches Octro's published limits for both boots", () => {
    expect(potLimitFor(2)).toBe(2048);
    expect(potLimitFor(4)).toBe(4096);
    expect(maxStakeFor(2) * 2).toBe(256);
    expect(maxStakeFor(4) * 2).toBe(512);
  });

  it("forces a player to see after the maximum number of blinds", () => {
    const s = game({ boot: 10, stacks: [100000, 100000, 100000] });
    s.players[0]!.blindCount = TP_MAX_BLINDS;
    const a = legalActions(s, 1).actions;
    expect(a).toContain("see");
    expect(a).not.toContain("blind");
    expect(a).not.toContain("raise");
    act(s, 1, "see");
    expect(legalActions(s, 1).actions).toContain("chaal");
  });

  it("counts blind bets and raises, but not the boot or seen bets", () => {
    const s = game({ boot: 10, stacks: [5000, 5000, 5000] });
    act(s, 1, "blind");
    act(s, 2, "raise");
    expect(s.players[0]!.blindCount).toBe(1);
    expect(s.players[1]!.blindCount).toBe(1);
    act(s, 3, "see");
    act(s, 3, "chaal");
    expect(s.players[2]!.blindCount).toBe(0);
  });
});

describe("turn order", () => {
  it("passes the turn to the next player after someone packs (not the lowest seat)", () => {
    const s = game({ stacks: [500, 500, 500, 500] });
    act(s, 1, "blind"); // seat 0
    act(s, 2, "blind"); // seat 1
    expect(s.actingSeat).toBe(2);
    act(s, 3, "pack"); // seat 2 folds: next must be seat 3, not seat 0
    expect(s.actingSeat).toBe(3);
  });

  it("wraps past the end of the table and skips packed players", () => {
    const s = game({ stacks: [500, 500, 500, 500] });
    act(s, 1, "pack"); // seat 0
    act(s, 2, "blind"); // seat 1
    act(s, 3, "pack"); // seat 2
    act(s, 4, "blind"); // seat 3 → wraps; seats 0 and 2 are out
    expect(s.actingSeat).toBe(1);
  });

  it("works with gaps in the seat numbers", () => {
    const s = game({ stacks: [500, 500, 500], seats: [1, 4, 7] });
    expect(s.actingSeat).toBe(1);
    act(s, 1, "pack");
    expect(s.actingSeat).toBe(4);
    act(s, 2, "pack");
    expect(s.players.filter((p) => !p.packed)).toHaveLength(1);
  });
});

describe("ending a hand", () => {
  it("awards the whole pot when everyone else packs", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    const startTotal = total(s);
    act(s, 1, "blind");
    act(s, 2, "pack");
    const r = act(s, 3, "pack");
    expect(r.handOver).toBe(true);
    expect(r.result!.winners).toEqual([{ userId: 1, amount: 40 }]);
    expect(total(s, true)).toBe(startTotal);
  });

  it("only allows a show when two players remain", () => {
    const s = game({ stacks: [500, 500, 500] });
    expect(legalActions(s, 1).actions).not.toContain("show");
    act(s, 1, "pack");
    expect(legalActions(s, 2).actions).toContain("show");
  });

  it("a show compares the hands and pays the winner", () => {
    const s = game({
      boot: 10,
      stacks: [500, 500],
      cards: [
        ["Ah", "Ad", "Ac"], // trail
        ["Kh", "Qd", "Jc"], // sequence
      ],
    });
    const startTotal = total(s);
    const r = act(s, 1, "show");
    expect(r.handOver).toBe(true);
    expect(r.result!.winners[0]!.userId).toBe(1);
    expect(r.result!.reveals.map((x) => x.handRank)).toEqual(["Trail", "Sequence"]);
    expect(total(s, true)).toBe(startTotal);
  });

  it("splits the pot on an exact tie without losing a cent", () => {
    const s = game({
      boot: 10,
      stacks: [500, 500],
      cards: [
        ["Ah", "9d", "3c"],
        ["As", "9c", "3h"],
      ],
    });
    const startTotal = total(s);
    const r = act(s, 1, "show");
    expect(r.result!.winners).toHaveLength(2);
    expect(r.result!.winners.reduce((n, w) => n + w.amount, 0)).toBe(r.result!.pot);
    expect(total(s, true)).toBe(startTotal);
  });

  it("forces a show when the pot limit is reached", () => {
    const s = game({
      boot: 2,
      stacks: [100000, 100000, 100000],
      cards: [
        ["2h", "5d", "9c"],
        ["Ah", "Ad", "Ac"],
        ["3h", "6d", "Jc"],
      ],
    });
    s.pot = potLimitFor(2) - 1; // one bet from the limit
    const startTotal = total(s);
    const r = act(s, 1, "blind");
    expect(r.handOver).toBe(true);
    expect(r.result!.reveals).toHaveLength(3); // everyone shows
    expect(r.result!.winners[0]!.userId).toBe(2);
    expect(total(s, true)).toBe(startTotal);
  });
});

describe("running out of money", () => {
  it("cannot make a bet it cannot afford (no partial or free calls)", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    s.players[0]!.stack = 15; // enough for a blind (10) but not a seen chaal (20)
    act(s, 1, "see");
    const a = legalActions(s, 1).actions;
    expect(a).not.toContain("chaal");
    expect(a).not.toContain("raise");
    expect(a).toContain("pack");
  });

  it("folds a broke player automatically when 3+ players remain", () => {
    const s = game({ boot: 10, stacks: [500, 500, 500] });
    s.players[1]!.stack = 5; // cannot cover even a blind bet
    act(s, 1, "blind");
    expect(s.players[1]!.packed).toBe(true);
    expect(s.actingSeat).toBe(2); // skipped straight to player 3
  });

  it("lets a short stack go all-in on a heads-up show, and returns the uncalled excess", () => {
    const s = game({
      boot: 10,
      stacks: [500, 500],
      cards: [
        ["Ah", "Ad", "Ac"], // short stack has the best hand
        ["Kh", "Qd", "Jc"],
      ],
    });
    // Player 2 has put a lot in; player 1 only has 6 left and must show.
    s.players[1]!.totalBet += 100;
    s.players[1]!.stack -= 100;
    s.pot += 100;
    s.players[0]!.stack = 6;
    const startTotal = total(s);
    expect(legalActions(s, 1).actions).toContain("show");
    const r = act(s, 1, "show");
    expect(r.handOver).toBe(true);
    expect(total(s, true)).toBe(startTotal); // no money created or lost
    // Player 1 matched 16 (boot 10 + 6); player 2 had put in 110. The 94 that player 1
    // could not match goes back to player 2, and player 1 wins the 32 that was contested.
    expect(s.players[0]!.stack).toBe(32);
    expect(s.players[1]!.stack).toBe(500 - 110 + 94);
  });
});

describe("timeouts", () => {
  it("an away player packs instead of betting", () => {
    const s = game({ stacks: [500, 500, 500] });
    expect(timeoutAction(s, 1)).toBe("pack");
    act(s, 1, timeoutAction(s, 1));
    expect(s.players[0]!.packed).toBe(true);
  });
});

describe("money safety", () => {
  it("never creates or loses money across thousands of random hands, and every hand ends", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let g = 0; g < 3000; g += 1) {
      const n = 2 + Math.floor(rnd() * 5);
      const boot = [1, 2, 5, 10][Math.floor(rnd() * 4)]!;
      const s = game({
        boot,
        stacks: Array.from({ length: n }, () => boot * (2 + Math.floor(rnd() * 400))),
      });
      const startTotal = total(s);
      let over = false;
      for (let step = 0; step < 5000 && !over; step += 1) {
        const p = s.players.find((x) => x.seatIndex === s.actingSeat)!;
        const legal = legalActions(s, p.userId);
        expect(legal.actions.length).toBeGreaterThan(0); // the table never stalls
        const choice = legal.actions[Math.floor(rnd() * legal.actions.length)]!;
        const r = applyAction(s, p.userId, choice);
        expect(r.ok).toBe(true);
        if (r.ok) over = r.handOver;
        expect(total(s, over)).toBe(startTotal);
        expect(s.players.every((x) => x.stack >= 0)).toBe(true);
      }
      expect(over).toBe(true);
    }
  });
});
