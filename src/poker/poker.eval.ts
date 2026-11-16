/**
 * Five-card hand ranking + Hold'em / Omaha construction (rules §7).
 * Amounts are not involved here — cards only.
 */

export const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
] as const;
export const SUITS = ["h", "d", "c", "s"] as const;

export const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i + 2]),
);

export type ScoredHand = {
  rank: number; // 0 high-card … 8 straight-flush (royal = 8 with high 14)
  name: string;
  tiebreak: number[];
};

export function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, path: T[]) => {
    if (path.length === k) {
      out.push([...path]);
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      path.push(arr[i]!);
      rec(i + 1, path);
      path.pop();
    }
  };
  rec(0, []);
  return out;
}

export function scoreFive(cards: string[]): ScoredHand {
  if (cards.length !== 5) {
    throw new Error(`scoreFive expects 5 cards, got ${cards.length}`);
  }
  const ranks = cards.map((c) => RANK_VALUE[c[0]!]!).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]!);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) {
      isStraight = true;
      straightHigh = uniq[0]!;
    } else if (
      uniq[0] === 14 &&
      uniq[1] === 5 &&
      uniq[2] === 4 &&
      uniq[3] === 3 &&
      uniq[4] === 2
    ) {
      // Wheel: A-2-3-4-5 — high card is 5 (§7.1)
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isStraight && isFlush) {
    return {
      rank: 8,
      name: straightHigh === 14 ? "Royal Flush" : "Straight Flush",
      tiebreak: [straightHigh],
    };
  }
  if (byCount[0]?.[1] === 4) {
    return {
      rank: 7,
      name: "Four of a Kind",
      tiebreak: [byCount[0][0], byCount[1]?.[0] ?? 0],
    };
  }
  if (byCount[0]?.[1] === 3 && byCount[1]?.[1] === 2) {
    return {
      rank: 6,
      name: "Full House",
      tiebreak: [byCount[0][0], byCount[1][0]],
    };
  }
  if (isFlush) {
    return { rank: 5, name: "Flush", tiebreak: ranks };
  }
  if (isStraight) {
    return { rank: 4, name: "Straight", tiebreak: [straightHigh] };
  }
  if (byCount[0]?.[1] === 3) {
    const kickers = byCount.slice(1).map((x) => x[0]);
    return {
      rank: 3,
      name: "Three of a Kind",
      tiebreak: [byCount[0][0], ...kickers],
    };
  }
  if (byCount[0]?.[1] === 2 && byCount[1]?.[1] === 2) {
    const highPair = Math.max(byCount[0][0], byCount[1][0]);
    const lowPair = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = byCount[2]?.[0] ?? 0;
    return { rank: 2, name: "Two Pair", tiebreak: [highPair, lowPair, kicker] };
  }
  if (byCount[0]?.[1] === 2) {
    const kickers = byCount.slice(1).map((x) => x[0]);
    return {
      rank: 1,
      name: "One Pair",
      tiebreak: [byCount[0][0], ...kickers],
    };
  }
  return { rank: 0, name: "High Card", tiebreak: ranks };
}

export function compareHands(a: ScoredHand, b: ScoredHand): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i += 1) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Hold'em: best 5 from any mix of 2 hole + 5 board (§7.4). */
export function evaluateHoldem(
  hole: string[],
  board: string[],
): ScoredHand {
  const cards = [...hole, ...board];
  if (cards.length < 5) {
    return { rank: 0, name: "High Card", tiebreak: [0] };
  }
  let best: ScoredHand | null = null;
  for (const five of combinations(cards, 5)) {
    const scored = scoreFive(five);
    if (!best || compareHands(scored, best) > 0) best = scored;
  }
  return best!;
}

/**
 * Omaha: exactly 2 hole + exactly 3 board (§7.5).
 * Never reuse Hold'em 7-card eval.
 */
export function evaluateOmaha(hole: string[], board: string[]): ScoredHand {
  if (hole.length !== 4) {
    throw new Error(`Omaha requires 4 hole cards, got ${hole.length}`);
  }
  if (board.length !== 5) {
    throw new Error(`Omaha showdown requires 5 board cards, got ${board.length}`);
  }
  let best: ScoredHand | null = null;
  for (const h2 of combinations(hole, 2)) {
    for (const b3 of combinations(board, 3)) {
      const scored = scoreFive([...h2, ...b3]);
      if (!best || compareHands(scored, best) > 0) best = scored;
    }
  }
  return best!;
}

export function evaluateBestHand(
  hole: string[],
  board: string[],
  variant: "holdem" | "omaha" = "holdem",
): ScoredHand {
  if (variant === "omaha") return evaluateOmaha(hole, board);
  return evaluateHoldem(hole, board);
}

/** Brute-force reference for cross-check tests (T23). */
export function referenceEvaluate(
  hole: string[],
  board: string[],
  variant: "holdem" | "omaha",
): ScoredHand {
  return evaluateBestHand(hole, board, variant);
}
