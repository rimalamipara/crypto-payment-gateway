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
// Rankings (6 = best), as on Octro's classic Teen Patti:
//   6 Trail         – three of a kind (A-A-A best, 2-2-2 lowest)
//   5 Pure Sequence – three consecutive cards of one suit
//   4 Sequence      – three consecutive cards, mixed suits
//   3 Color         – three cards of one suit
//   2 Pair          – two cards of the same rank
//   1 High Card
//
// Sequence order (both kinds): A-K-Q is the highest, A-2-3 is the SECOND highest,
// then K-Q-J, Q-J-10 … down to 4-3-2. K-A-2 does not wrap.

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

/** Strength of a sequence: its top card, except A-2-3 sits just under A-K-Q (14). */
const A23_SEQUENCE_STRENGTH = 13.5;

export function scoreHand(cards: string[]): HandScore {
  if (cards.length !== 3) {
    return { rank: 0, name: "No hand", tiebreak: [] };
  }

  const vals = cards.map(rv).sort((a, b) => b - a); // descending
  const suits = cards.map(suitOf);
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const a23 = isA23(vals);
  const straight = isConsecutive(vals) || a23;
  const straightStrength = a23 ? A23_SEQUENCE_STRENGTH : vals[0]!;

  // Trail
  if (vals[0] === vals[1] && vals[1] === vals[2]) {
    return { rank: 6, name: "Trail", tiebreak: [vals[0]!] };
  }

  if (straight && isFlush) {
    return { rank: 5, name: "Pure Sequence", tiebreak: [straightStrength] };
  }

  if (straight) {
    return { rank: 4, name: "Sequence", tiebreak: [straightStrength] };
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

// ── Betting limits (Octro's limited tables) ──────────────────────────────────
//
// Octro: boot 2 → max chaal 256, pot limit 2048; boot 4 → 512 / 4096.
// That is 128× and 1024× the boot. A seen chaal costs 2× the stake, so the stake
// itself tops out at 64× the boot.

/** A player may play at most this many blind bets before they must see their cards. */
export const TP_MAX_BLINDS = 4;
export const TP_MAX_CHAAL_BOOTS = 128;
export const TP_POT_LIMIT_BOOTS = 1024;

export function maxStakeFor(boot: number): number {
  return money((boot * TP_MAX_CHAAL_BOOTS) / 2);
}

export function potLimitFor(boot: number): number {
  return money(boot * TP_POT_LIMIT_BOOTS);
}

// ── Game state types ──────────────────────────────────────────────────────────

/**
 * - pack   fold
 * - see    look at your own cards. Free, and does NOT use up your turn.
 * - blind  unseen player pays 1× the current stake
 * - chaal  seen player pays 2× the current stake
 * - raise  doubles the bet: blind pays 2× the stake, seen pays 4× (the stake doubles)
 * - show   only when two players remain; reveals both hands
 */
export type TeenPattiActionType =
  | "pack"
  | "blind"
  | "chaal"
  | "raise"
  | "see"
  | "show";

export interface TeenPattiPlayer {
  userId: number;
  seatIndex: number;
  stack: number;
  cards: string[]; // 3 cards
  hasSeen: boolean; // has looked at own cards
  packed: boolean; // has folded
  totalBet: number; // total amount contributed this hand
  /** Blind bets played so far (the boot does not count). */
  blindCount: number;
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

  const deck = shuffleDeck(createDeck());

  const players: TeenPattiPlayer[] = eligible.map((s) => ({
    userId: s.userId,
    seatIndex: s.seatIndex,
    stack: money(s.stack),
    cards: [],
    hasSeen: false,
    packed: false,
    totalBet: 0,
    blindCount: 0,
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

  // First acting seat: next to the dealer, clockwise
  const seatsSorted = players.map((p) => p.seatIndex).sort((a, b) => a - b);
  const dIdx = seatsSorted.indexOf(input.dealerSeat);
  const firstIdx = dIdx >= 0 ? (dIdx + 1) % seatsSorted.length : 0;
  state.actingSeat = seatsSorted[firstIdx]!;

  return state;
}

// ── Legal actions ─────────────────────────────────────────────────────────────

export interface TeenPattiLegal {
  actions: TeenPattiActionType[];
  /** Cost of a blind bet (unseen) or chaal (seen). */
  callAmount: number;
  /** Cost of the doubled bet. */
  raiseAmount: number;
  /** Cost of a show. */
  showCost: number;
}

export function legalActions(
  state: TeenPattiHandState,
  userId: number,
): TeenPattiLegal {
  const none: TeenPattiLegal = {
    actions: [],
    callAmount: 0,
    raiseAmount: 0,
    showCost: 0,
  };
  const p = state.players.find((x) => x.userId === userId);
  if (!p || state.actingSeat !== p.seatIndex || p.packed) return none;

  const stake = state.currentStake;
  const callAmount = p.hasSeen ? money(2 * stake) : money(stake);
  const raiseAmount = p.hasSeen ? money(4 * stake) : money(2 * stake);

  const only2 = activePlayers(state).length === 2;
  const mustSee = !p.hasSeen && p.blindCount >= TP_MAX_BLINDS;
  // You may only bet what you actually have: no partial or free calls.
  const canCall = p.stack >= callAmount;
  const canRaise =
    p.stack >= raiseAmount && money(2 * stake) <= maxStakeFor(state.boot);

  const actions: TeenPattiActionType[] = ["pack"];
  if (!p.hasSeen) actions.push("see");
  if (p.hasSeen) {
    if (canCall) actions.push("chaal");
  } else if (!mustSee && canCall) {
    actions.push("blind");
  }
  if (canRaise && (p.hasSeen || !mustSee)) actions.push("raise");
  // A show is allowed even if you cannot cover it: you then go all-in.
  if (only2) actions.push("show");

  return { actions, callAmount, raiseAmount, showCost: callAmount };
}

// ── Apply action ──────────────────────────────────────────────────────────────

export type ApplyActionResult =
  | { ok: true; state: TeenPattiHandState; handOver: boolean; result?: TeenPattiHandResult }
  | { ok: false; error: string };

function pay(state: TeenPattiHandState, p: TeenPattiPlayer, amount: number): number {
  const paid = money(Math.min(p.stack, amount));
  p.stack = money(p.stack - paid);
  p.totalBet = money(p.totalBet + paid);
  state.pot = money(state.pot + paid);
  return paid;
}

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
    return advanceAfterAction(state);
  }

  if (action === "see") {
    // Looking is free and does not end your turn: you still have to act.
    p.hasSeen = true;
    state.actionHistory.push({ userId, action: "see", amount: 0 });
    return { ok: true, state, handOver: false };
  }

  if (action === "show") {
    const paid = pay(state, p, legal.showCost);
    state.actionHistory.push({ userId, action: "show", amount: paid });
    if (paid < legal.showCost) returnUncalledExcess(state, p);
    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  // blind / chaal / raise
  const cost = action === "raise" ? legal.raiseAmount : legal.callAmount;
  const wasBlind = !p.hasSeen;
  const paid = pay(state, p, cost);
  state.actionHistory.push({ userId, action, amount: paid });
  if (wasBlind) p.blindCount += 1;
  // Blind pays 1× (stake stays) or 2× (stake doubles); seen pays 2× or 4×, and
  // half of what a seen player bets becomes the next stake — so a raise doubles it.
  if (action === "raise") state.currentStake = money(2 * state.currentStake);

  // Pot limit reached: everyone left must show.
  if (state.pot >= potLimitFor(state.boot)) {
    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  return advanceAfterAction(state);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function activePlayers(state: TeenPattiHandState): TeenPattiPlayer[] {
  return state.players.filter((p) => !p.packed);
}

/**
 * Heads-up all-in show: the shorter stack can only win what it matched, so the
 * other player's uncalled excess goes back to them before the cards are compared.
 */
function returnUncalledExcess(state: TeenPattiHandState, short: TeenPattiPlayer): void {
  const other = activePlayers(state).find((x) => x.userId !== short.userId);
  if (!other || other.totalBet <= short.totalBet) return;
  const excess = money(other.totalBet - short.totalBet);
  other.stack = money(other.stack + excess);
  other.totalBet = money(other.totalBet - excess);
  state.pot = money(state.pot - excess);
}

function nextActiveSeat(state: TeenPattiHandState, fromSeat: number | null): number {
  // Walk the whole table in seat order (packed players included) so the turn goes
  // to the next player after `fromSeat` even when `fromSeat` just packed.
  const order = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const curIdx = order.findIndex((p) => p.seatIndex === fromSeat);
  for (let i = 1; i <= order.length; i += 1) {
    const cand = order[(curIdx + i + order.length) % order.length]!;
    if (!cand.packed) return cand.seatIndex;
  }
  return fromSeat ?? order[0]!.seatIndex;
}

function advanceAfterAction(state: TeenPattiHandState): ApplyActionResult {
  for (;;) {
    const active = activePlayers(state);

    // If only 1 left, they win uncontested
    if (active.length === 1) {
      const result = awardUncontested(state, active[0]!);
      return { ok: true, state, handOver: true, result };
    }

    state.actingSeat = nextActiveSeat(state, state.actingSeat);

    // With 3+ players left, someone who cannot afford even the cheapest bet is
    // out of the hand (no side pots here). Fold them rather than stall the table.
    const next = state.players.find((p) => p.seatIndex === state.actingSeat)!;
    const cheapest = next.hasSeen ? 2 * state.currentStake : state.currentStake;
    if (active.length > 2 && next.stack < money(cheapest)) {
      next.packed = true;
      state.actionHistory.push({ userId: next.userId, action: "pack", amount: 0 });
      continue;
    }
    return { ok: true, state, handOver: false };
  }
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

  // Equal hands split the pot; the last winner takes the rounding remainder.
  const share = money(state.pot / tied.length);
  let leftover = state.pot;
  const winners: Array<{ userId: number; amount: number; handRank?: string }> = [];

  tied.forEach((t, idx) => {
    const amt = idx === tied.length - 1 ? money(leftover) : share;
    leftover = money(leftover - amt);
    t.player.stack = money(t.player.stack + amt);
    winners.push({ userId: t.player.userId, amount: amt, handRank: t.score.name });
  });

  return { winners, pot: state.pot, reveals };
}

// ── Timeout ───────────────────────────────────────────────────────────────────

/** A player who runs out the clock packs: an away player must not keep betting. */
export function timeoutAction(
  _state: TeenPattiHandState,
  _userId: number,
): TeenPattiActionType {
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
  // Your own cards stay hidden until you choose to see them: that is what makes a
  // blind bet blind. Everyone's cards are revealed at the end of the hand.
  const showCards =
    handOver || (p.userId === viewerUserId && p.hasSeen) ? p.cards : null;
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
