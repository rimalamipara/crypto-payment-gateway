import { randomBytes } from "node:crypto";

// ── Card helpers ──────────────────────────────────────────────────────────────

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const SUITS = ["h", "d", "c", "s"] as const;
const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i + 2]),
);

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function createDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

export function shuffleDeck(deck: string[]): string[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const buf = randomBytes(4);
    const j = buf.readUInt32BE(0) % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function rankOf(card: string): string {
  return card.slice(0, -1);
}

function suitOf(card: string): string {
  return card.slice(-1);
}

function rv(card: string): number {
  return RANK_VALUE[rankOf(card)]!;
}

// ── Hand evaluation ───────────────────────────────────────────────────────────
//
// Rankings (6 = best):
//   6 Trail        – three of a kind (e.g. A-A-A)
//   5 Pure Sequence – straight flush  (e.g. A-K-Q same suit)
//   4 Sequence     – straight         (e.g. 5-4-3 mixed suits)
//   3 Color        – flush            (e.g. A-J-7 same suit)
//   2 Pair         – one pair
//   1 High Card

export interface HandScore {
  rank: number;
  name: string;
  tiebreak: number[];
}

function isConsecutive(sortedDesc: number[]): boolean {
  return (
    sortedDesc.length === 3 &&
    sortedDesc[0]! - sortedDesc[1]! === 1 &&
    sortedDesc[1]! - sortedDesc[2]! === 1
  );
}

function isA23(vals: number[]): boolean {
  // A=14, 2=2, 3=3 → sorted asc [2, 3, 14]
  const s = [...vals].sort((a, b) => a - b);
  return s[0] === 2 && s[1] === 3 && s[2] === 14;
}

export function scoreHand(cards: string[]): HandScore {
  if (cards.length !== 3) {
    return { rank: 0, name: "No hand", tiebreak: [] };
  }

  const vals = cards.map(rv).sort((a, b) => b - a); // descending
  const suits = cards.map(suitOf);
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const a23 = isA23(vals);
  const straight = isConsecutive(vals) || a23;
  // For A-2-3, treat the high card as 3 for ordering (lowest straight)
  const straightHigh = a23 ? 3 : vals[0]!;

  // Trail
  if (vals[0] === vals[1] && vals[1] === vals[2]) {
    return { rank: 6, name: "Trail", tiebreak: [vals[0]!] };
  }

  if (straight && isFlush) {
    return {
      rank: 5,
      name: "Pure Sequence",
      tiebreak: [straightHigh, vals[0]!, vals[1]!, vals[2]!],
    };
  }

  if (straight) {
    return {
      rank: 4,
      name: "Sequence",
      tiebreak: [straightHigh, vals[0]!, vals[1]!, vals[2]!],
    };
  }

  if (isFlush) {
    return { rank: 3, name: "Color", tiebreak: vals };
  }

  // Pair
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const pairEntry = [...counts.entries()].find(([, c]) => c === 2);
  if (pairEntry) {
    const pairVal = pairEntry[0];
    const kicker = vals.find((v) => v !== pairVal)!;
    return { rank: 2, name: "Pair", tiebreak: [pairVal, kicker] };
  }

  // High card
  return { rank: 1, name: "High Card", tiebreak: vals };
}

/** Returns positive if a beats b, negative if b beats a, 0 for tie. */
export function compareHands(a: HandScore, b: HandScore): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i += 1) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Game state types ──────────────────────────────────────────────────────────

export type TeenPattiActionType = "pack" | "blind" | "chaal" | "see" | "show";

export interface TeenPattiPlayer {
  userId: number;
  seatIndex: number;
  stack: number;
  cards: string[]; // 3 cards
  hasSeen: boolean; // has looked at own cards
  packed: boolean; // has folded
  totalBet: number; // total amount contributed this hand
}

export interface TeenPattiHandResult {
  winners: Array<{ userId: number; amount: number; handRank?: string }>;
  pot: number;
  reveals: Array<{ userId: number; cards: string[]; handRank: string }>;
}

export interface TeenPattiHandState {
  handId: number;
  handNo: number;
  boot: number; // the per-player ante/stake
  currentStake: number; // amount a blind player pays per chaal
  pot: number;
  actingSeat: number | null;
  players: TeenPattiPlayer[];
  actionHistory: Array<{
    userId: number;
    action: TeenPattiActionType;
    amount: number;
  }>;
  startedAt: string;
}

// ── Start hand ────────────────────────────────────────────────────────────────

export function startHand(input: {
  handId: number;
  handNo: number;
  boot: number;
  seats: Array<{ userId: number; seatIndex: number; stack: number }>;
  dealerSeat: number;
}): TeenPattiHandState {
  const eligible = input.seats.filter((s) => s.stack >= input.boot);
  if (eligible.length < 2) {
    throw new Error("Need at least 2 players with enough chips to start");
  }

  let deck = shuffleDeck(createDeck());

  const players: TeenPattiPlayer[] = eligible.map((s) => ({
    userId: s.userId,
    seatIndex: s.seatIndex,
    stack: money(s.stack),
    cards: [],
    hasSeen: false,
    packed: false,
    totalBet: 0,
  }));

  // Deal 3 cards each
  for (const p of players) {
    p.cards = [deck.pop()!, deck.pop()!, deck.pop()!];
  }

  const state: TeenPattiHandState = {
    handId: input.handId,
    handNo: input.handNo,
    boot: money(input.boot),
    currentStake: money(input.boot),
    pot: 0,
    actingSeat: null,
    players,
    actionHistory: [],
    startedAt: new Date().toISOString(),
  };

  // Collect boot ante from each player
  for (const p of players) {
    const pay = money(Math.min(p.stack, state.boot));
    p.stack = money(p.stack - pay);
    p.totalBet = money(p.totalBet + pay);
    state.pot = money(state.pot + pay);
    state.actionHistory.push({ userId: p.userId, action: "blind", amount: pay });
  }

  // First acting seat: left of dealer
  const seatsSorted = players.map((p) => p.seatIndex).sort((a, b) => a - b);
  const dIdx = seatsSorted.indexOf(input.dealerSeat);
  const firstIdx = dIdx >= 0 ? (dIdx + 1) % seatsSorted.length : 0;
  state.actingSeat = seatsSorted[firstIdx]!;

  return state;
}

// ── Legal actions ─────────────────────────────────────────────────────────────

export function legalActions(
  state: TeenPattiHandState,
  userId: number,
): {
  actions: TeenPattiActionType[];
  callAmount: number; // what it costs to call (chaal/blind)
  showCost: number; // what it costs to call show
} {
  const p = state.players.find((x) => x.userId === userId);
  if (!p || state.actingSeat !== p.seatIndex || p.packed) {
    return { actions: [], callAmount: 0, showCost: 0 };
  }

  const active = state.players.filter((x) => !x.packed);
  const only2 = active.length === 2;
  const callAmt = p.hasSeen
    ? money(2 * state.currentStake)
    : money(state.currentStake);
  const showCost = p.hasSeen
    ? money(2 * state.currentStake)
    : money(state.currentStake);

  const actions: TeenPattiActionType[] = ["pack"];

  if (p.hasSeen) {
    actions.push("chaal");
  } else {
    actions.push("see"); // look at cards without paying
    actions.push("blind"); // call without looking
  }

  if (only2) {
    actions.push("show");
  }

  return { actions, callAmount: callAmt, showCost };
}

// ── Apply action ──────────────────────────────────────────────────────────────

export type ApplyActionResult =
  | { ok: true; state: TeenPattiHandState; handOver: boolean; result?: TeenPattiHandResult }
  | { ok: false; error: string };

export function applyAction(
  state: TeenPattiHandState,
  userId: number,
  action: TeenPattiActionType,
): ApplyActionResult {
  const p = state.players.find((x) => x.userId === userId);
  if (!p) return { ok: false, error: "Player not in hand" };
  if (state.actingSeat !== p.seatIndex) return { ok: false, error: "Not your turn" };
  if (p.packed) return { ok: false, error: "Already packed" };

  const legal = legalActions(state, userId);
  if (!legal.actions.includes(action)) {
    return { ok: false, error: `Illegal action: ${action}` };
  }

  if (action === "pack") {
    p.packed = true;
    state.actionHistory.push({ userId, action: "pack", amount: 0 });

  } else if (action === "see") {
    p.hasSeen = true;
    state.actionHistory.push({ userId, action: "see", amount: 0 });
    // Player has used their turn to see — now advance to next player
    return advanceAfterAction(state);

  } else if (action === "blind") {
    // Blind call
    const pay = money(Math.min(p.stack, legal.callAmount));
    p.stack = money(p.stack - pay);
    p.totalBet = money(p.totalBet + pay);
    state.pot = money(state.pot + pay);
    state.actionHistory.push({ userId, action: "blind", amount: pay });

  } else if (action === "chaal") {
    const pay = money(Math.min(p.stack, legal.callAmount));
    p.stack = money(p.stack - pay);
    p.totalBet = money(p.totalBet + pay);
    state.pot = money(state.pot + pay);
    state.actionHistory.push({ userId, action: "chaal", amount: pay });

  } else if (action === "show") {
    // Pay show cost then reveal
    const pay = money(Math.min(p.stack, legal.showCost));
    if (pay > 0) {
      p.stack = money(p.stack - pay);
      p.totalBet = money(p.totalBet + pay);
      state.pot = money(state.pot + pay);
    }
    state.actionHistory.push({ userId, action: "show", amount: pay });

    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  return advanceAfterAction(state);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function activePlayers(state: TeenPattiHandState): TeenPattiPlayer[] {
  return state.players.filter((p) => !p.packed);
}

function advanceAfterAction(state: TeenPattiHandState): ApplyActionResult {
  const active = activePlayers(state);

  // If only 1 left, they win uncontested
  if (active.length === 1) {
    const winner = active[0]!;
    const result = awardUncontested(state, winner);
    return { ok: true, state, handOver: true, result };
  }

  // Advance to next non-packed player
  const seatsSorted = state.players
    .filter((p) => !p.packed)
    .map((p) => p.seatIndex)
    .sort((a, b) => a - b);

  const cur = state.actingSeat ?? seatsSorted[0]!;
  const curIdx = seatsSorted.indexOf(cur);
  const nextSeat = seatsSorted[(curIdx + 1) % seatsSorted.length]!;
  state.actingSeat = nextSeat;

  return { ok: true, state, handOver: false };
}

function awardUncontested(
  state: TeenPattiHandState,
  winner: TeenPattiPlayer,
): TeenPattiHandResult {
  winner.stack = money(winner.stack + state.pot);
  return {
    winners: [{ userId: winner.userId, amount: state.pot }],
    pot: state.pot,
    reveals: [],
  };
}

function resolveShowdown(state: TeenPattiHandState): TeenPattiHandResult {
  const active = activePlayers(state);
  const reveals: Array<{ userId: number; cards: string[]; handRank: string }> = [];

  const scored = active.map((p) => {
    const score = scoreHand(p.cards);
    reveals.push({ userId: p.userId, cards: p.cards, handRank: score.name });
    return { player: p, score };
  });

  scored.sort((a, b) => compareHands(b.score, a.score));
  const best = scored[0]!.score;
  const tied = scored.filter((s) => compareHands(s.score, best) === 0);

  const share = money(state.pot / tied.length);
  let leftover = state.pot;
  const winners: Array<{ userId: number; amount: number; handRank?: string }> = [];

  tied.forEach((t, idx) => {
    const amt = idx === tied.length - 1 ? leftover : share;
    leftover = money(leftover - share);
    t.player.stack = money(t.player.stack + amt);
    winners.push({ userId: t.player.userId, amount: amt, handRank: t.score.name });
  });

  return { winners, pot: state.pot, reveals };
}

// ── Timeout ───────────────────────────────────────────────────────────────────

export function timeoutAction(
  state: TeenPattiHandState,
  userId: number,
): TeenPattiActionType {
  const legal = legalActions(state, userId);
  if (legal.actions.includes("blind")) return "blind";
  if (legal.actions.includes("chaal")) return "chaal";
  return "pack";
}

// ── Public view ───────────────────────────────────────────────────────────────

export function publicPlayerView(
  p: TeenPattiPlayer,
  viewerUserId: number | null,
  handOver: boolean,
): {
  userId: number;
  seatIndex: number;
  stack: number;
  hasSeen: boolean;
  packed: boolean;
  totalBet: number;
  cards: string[] | null;
} {
  const showCards =
    handOver || p.userId === viewerUserId ? p.cards : null;
  return {
    userId: p.userId,
    seatIndex: p.seatIndex,
    stack: p.userId === viewerUserId ? p.stack : 0,
    hasSeen: p.hasSeen,
    packed: p.packed,
    totalBet: p.totalBet,
    cards: showCards,
  };
}
