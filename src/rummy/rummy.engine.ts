/**
 * Points Rummy Engine
 * ────────────────────────────────────────────────────────────
 * Rules:
 *  - 52-card deck (no jokers in this implementation; printed joker
 *    is the extra card from the closed deck after dealing).
 *  - 13 cards dealt to each player.
 *  - One card turned face-up → open discard pile; remaining → closed deck.
 *  - On your turn: draw from closed or open pile, then discard one card.
 *  - Declare: meld ALL 13 cards (no discard needed once declared – the
 *    final card completes the hand). Requires ≥1 pure sequence.
 *  - Scoring: face-value for 2-9; 10 pts for T/J/Q/K/A; joker (none here) = 0.
 *  - Cap: max 80 points per losing player.
 *  - Settlement: loser pays min(points, 80) × pointValue to winner's stack.
 */

import { randomBytes } from "node:crypto";
import { RUMMY_MAX_POINTS } from "./rummy.constants.ts";

// ─── Card helpers ──────────────────────────────────────────────────────────────

export const RANKS = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K",
] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ["h", "d", "c", "s"] as const;
export type Suit = (typeof SUITS)[number];

export type Card = string; // e.g. "Ah", "Td", "2c"

const RANK_POINT: Record<string, number> = {
  A: 10, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, T: 10, J: 10, Q: 10, K: 10,
};

const RANK_ORDER: Record<string, number> = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13,
};

export function cardPoint(card: Card): number {
  const r = card.slice(0, -1);
  return RANK_POINT[r] ?? 10;
}

export function cardRank(card: Card): string {
  return card.slice(0, -1);
}

export function cardSuit(card: Card): string {
  return card.slice(-1);
}

export function rankOrder(card: Card): number {
  return RANK_ORDER[cardRank(card)] ?? 0;
}

// ─── Deck ──────────────────────────────────────────────────────────────────────

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const buf = randomBytes(4);
    const j = buf.readUInt32BE(0) % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ─── Meld validation ──────────────────────────────────────────────────────────

/** A meld is either a sequence (run) or a set (group) */
export type MeldType = "pure_sequence" | "impure_sequence" | "set";

export interface Meld {
  type: MeldType;
  cards: Card[];
}

/** Returns true if cards form a pure sequence (same suit, consecutive ranks, no joker) */
export function isPureSequence(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const suit = cardSuit(cards[0]!);
  if (!cards.every((c) => cardSuit(c) === suit)) return false;
  const orders = cards.map(rankOrder).sort((a, b) => a - b);
  for (let i = 1; i < orders.length; i += 1) {
    if (orders[i]! - orders[i - 1]! !== 1) return false;
  }
  return true;
}

/** Returns true if cards form a set (same rank, different suits, 3-4 cards) */
export function isSet(cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = cardRank(cards[0]!);
  if (!cards.every((c) => cardRank(c) === rank)) return false;
  // All different suits
  const suits = cards.map(cardSuit);
  return new Set(suits).size === suits.length;
}

export function classifyMeld(cards: Card[]): MeldType | null {
  if (isPureSequence(cards)) return "pure_sequence";
  if (isSet(cards)) return "set";
  return null;
}

// ─── Declaration validation ───────────────────────────────────────────────────

export interface DeclareResult {
  valid: boolean;
  reason?: string;
  melds?: Meld[];
  pureSequences?: number;
}

/**
 * Validate a declaration.
 * melds: array of card groups the player claims (must cover exactly 13 cards).
 * The 14th card (the one just drawn) should be included in a meld group;
 * OR the player passes 14 cards with the "discard" being the last meld's
 * final card – handled here by accepting exactly 13 OR 14 cards (we discard
 * the extra provided via the action's discardCard field).
 */
export function validateDeclaration(melds: Card[][]): DeclareResult {
  const total = melds.reduce((s, m) => s + m.length, 0);
  if (total !== 13) {
    return { valid: false, reason: `Must meld exactly 13 cards (got ${total})` };
  }

  const classified: Meld[] = [];
  for (const group of melds) {
    const type = classifyMeld(group);
    if (!type) {
      return {
        valid: false,
        reason: `Invalid meld: ${group.join(",")} is neither a valid sequence nor a set`,
      };
    }
    classified.push({ type, cards: group });
  }

  const pureCount = classified.filter((m) => m.type === "pure_sequence").length;
  if (pureCount === 0) {
    return {
      valid: false,
      reason: "At least one pure sequence is required to declare",
    };
  }

  return { valid: true, melds: classified, pureSequences: pureCount };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Calculate the raw point value of a hand (the penalty points). */
export function scoreHand(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardPoint(c), 0);
}

/** Score after capping at RUMMY_MAX_POINTS */
export function cappedScore(rawPoints: number): number {
  return Math.min(rawPoints, RUMMY_MAX_POINTS);
}

// ─── Engine state ─────────────────────────────────────────────────────────────

export interface RummyPlayer {
  userId: number;
  seatIndex: number;
  stack: number; // current USD stack
  hand: Card[]; // 13 cards in hand
  drew: boolean; // drawn this turn?
  dropped: boolean;
  dropPenalty: number; // 0 = still in, 20 = early drop, 40 = middle drop
  declaredValid: boolean;
  finalPoints: number | null; // computed at end of hand
}

export type RummyPhase = "waiting" | "playing" | "ended";

export interface RummyHandState {
  handId: number;
  handNo: number;
  phase: RummyPhase;
  closedDeck: Card[];
  discardPile: Card[]; // top is last element
  players: RummyPlayer[];
  actingSeat: number | null;
  turnOrder: number[]; // seatIndex order for rotation
  winnerId: number | null;
  pointValue: number; // USD per point
  startedAt: string;
}

// ─── Start hand ───────────────────────────────────────────────────────────────

export function startHand(input: {
  handId: number;
  handNo: number;
  seats: Array<{ userId: number; seatIndex: number; stack: number }>;
  pointValue: number;
}): RummyHandState {
  if (input.seats.length < 2) {
    throw new Error("Need at least 2 players to start a Rummy hand");
  }

  let deck = shuffleDeck(createDeck());

  const players: RummyPlayer[] = input.seats.map((s) => ({
    userId: s.userId,
    seatIndex: s.seatIndex,
    stack: s.stack,
    hand: [],
    drew: false,
    dropped: false,
    dropPenalty: 0,
    declaredValid: false,
    finalPoints: null,
  }));

  // Deal 13 cards to each player
  for (let i = 0; i < 13; i += 1) {
    for (const p of players) {
      p.hand.push(deck.pop()!);
    }
  }

  // Turn one card face-up for discard pile
  const firstDiscard = deck.pop()!;

  const turnOrder = input.seats.map((s) => s.seatIndex).sort((a, b) => a - b);

  return {
    handId: input.handId,
    handNo: input.handNo,
    phase: "playing",
    closedDeck: deck,
    discardPile: [firstDiscard],
    players,
    actingSeat: turnOrder[0] ?? null,
    turnOrder,
    winnerId: null,
    pointValue: input.pointValue,
    startedAt: new Date().toISOString(),
  };
}

// ─── Action application ────────────────────────────────────────────────────────

export type RummyActionType =
  | "draw_closed"
  | "draw_open"
  | "discard"
  | "declare"
  | "drop";

export interface RummyActionInput {
  type: RummyActionType;
  /** For discard / declare (the card being discarded) */
  card?: Card;
  /** For declare: all 13 card melds */
  melds?: Card[][];
}

export type RummyActionResult =
  | { ok: true; state: RummyHandState; handOver: boolean; result?: RummyHandResult }
  | { ok: false; error: string };

export interface RummyHandResult {
  winnerId: number;
  winnerGain: number; // USD
  losers: Array<{ userId: number; rawPoints: number; cappedPoints: number; loss: number }>;
}

function nextSeat(state: RummyHandState, fromSeat: number): number | null {
  const active = state.turnOrder.filter((si) => {
    const p = state.players.find((x) => x.seatIndex === si);
    return p && !p.dropped && !p.declaredValid;
  });
  if (active.length === 0) return null;
  const idx = active.indexOf(fromSeat);
  return active[(idx + 1) % active.length] ?? null;
}

export function applyAction(
  state: RummyHandState,
  userId: number,
  input: RummyActionInput,
): RummyActionResult {
  if (state.phase !== "playing") {
    return { ok: false, error: "Hand is not in playing phase" };
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { ok: false, error: "Player not in hand" };
  if (state.actingSeat !== player.seatIndex) return { ok: false, error: "Not your turn" };
  if (player.dropped) return { ok: false, error: "You have already dropped" };

  if (input.type === "drop") {
    // Early drop: before drawing; middle drop: after at least one turn drawn
    const isEarly = !player.drew;
    player.dropped = true;
    player.dropPenalty = isEarly ? 20 : 40;
    player.finalPoints = player.dropPenalty;

    const remaining = activePlayers(state);
    if (remaining.length === 1) {
      return finishHand(state, remaining[0]!.userId);
    }
    if (remaining.length === 0) {
      // Everyone dropped — lowest drop penalty wins (tie: higher stack).
      const winner = pickDropWinner(state);
      return finishHand(state, winner.userId);
    }
    state.actingSeat = nextSeat(state, player.seatIndex);
    return { ok: true, state, handOver: false };
  }

  if (input.type === "draw_closed") {
    if (player.drew) return { ok: false, error: "Already drew this turn" };
    if (state.closedDeck.length === 0) {
      // Reshuffle discard (except top) into closed deck
      if (state.discardPile.length <= 1) {
        return { ok: false, error: "No cards left to draw" };
      }
      const top = state.discardPile.pop()!;
      state.closedDeck = shuffleDeck(state.discardPile);
      state.discardPile = [top];
    }
    const card = state.closedDeck.pop()!;
    player.hand.push(card);
    player.drew = true;
    return { ok: true, state, handOver: false };
  }

  if (input.type === "draw_open") {
    if (player.drew) return { ok: false, error: "Already drew this turn" };
    if (state.discardPile.length === 0) return { ok: false, error: "Discard pile is empty" };
    const card = state.discardPile.pop()!;
    player.hand.push(card);
    player.drew = true;
    return { ok: true, state, handOver: false };
  }

  if (input.type === "discard") {
    if (!player.drew) return { ok: false, error: "Must draw before discarding" };
    if (!input.card) return { ok: false, error: "card required for discard" };
    const idx = player.hand.indexOf(input.card);
    if (idx < 0) return { ok: false, error: `Card ${input.card} not in hand` };
    player.hand.splice(idx, 1);
    state.discardPile.push(input.card);
    player.drew = false;
    state.actingSeat = nextSeat(state, player.seatIndex);
    return { ok: true, state, handOver: false };
  }

  if (input.type === "declare") {
    if (!player.drew) return { ok: false, error: "Must draw before declaring" };
    if (!input.melds || input.melds.length === 0) {
      return { ok: false, error: "melds required for declare" };
    }

    // Player should have 14 cards (13 + drawn). They declare with melds covering 13
    // and the extra card (if any) is discarded implicitly OR they provide 14 cards
    // split into melds. We accept both: if melds total 13, the drawn card is
    // automatically discarded. If melds total 14, we discard the card NOT in melds.
    const meldCards = input.melds.flat();
    const handSet = [...player.hand];

    // Verify all meld cards are in player's hand
    for (const c of meldCards) {
      const hi = handSet.indexOf(c);
      if (hi < 0) return { ok: false, error: `Card ${c} not in your hand` };
      handSet.splice(hi, 1); // consume it
    }

    const result = validateDeclaration(input.melds);
    if (!result.valid) {
      return { ok: false, error: result.reason ?? "Invalid declaration" };
    }

    // Discard the leftover card (exactly one, since hand is 14 after draw)
    if (handSet.length === 1) {
      state.discardPile.push(handSet[0]!);
    }

    player.hand = meldCards; // store meld order for reference
    player.declaredValid = true;
    player.finalPoints = 0;
    player.drew = false;

    return finishHand(state, userId);
  }

  return { ok: false, error: "Unknown action type" };
}

function activePlayers(state: RummyHandState): RummyPlayer[] {
  return state.players.filter((p) => !p.dropped && !p.declaredValid);
}

/** When every player has dropped, crown the lowest-penalty dropper. */
export function pickDropWinner(state: RummyHandState): RummyPlayer {
  const sorted = [...state.players].sort((a, b) => {
    const pa = a.dropPenalty || a.finalPoints || 80;
    const pb = b.dropPenalty || b.finalPoints || 80;
    if (pa !== pb) return pa - pb;
    return b.stack - a.stack;
  });
  return sorted[0]!;
}

/** Resolve a stuck hand where 0–1 players remain active (e.g. after force-leave). */
export function resolveIfHandShouldEnd(
  state: RummyHandState,
): RummyActionResult | null {
  if (state.phase !== "playing") return null;
  const remaining = activePlayers(state);
  if (remaining.length === 1) {
    return finishHand(state, remaining[0]!.userId);
  }
  if (remaining.length === 0) {
    return finishHand(state, pickDropWinner(state).userId);
  }
  return null;
}

function finishHand(
  state: RummyHandState,
  winnerId: number,
): RummyActionResult {
  state.phase = "ended";
  state.winnerId = winnerId;
  state.actingSeat = null;

  // Score losers
  let totalLoss = 0;
  const losers: RummyHandResult["losers"] = [];

  for (const p of state.players) {
    if (p.userId === winnerId) continue;
    let rawPoints: number;
    if (p.dropped) {
      rawPoints = p.dropPenalty;
    } else {
      rawPoints = scoreHand(p.hand);
    }
    const capped = cappedScore(rawPoints);
    const loss = capped * state.pointValue;
    p.finalPoints = rawPoints;
    totalLoss += loss;
    losers.push({ userId: p.userId, rawPoints, cappedPoints: capped, loss });
  }

  // Deduct losses from loser stacks
  for (const loser of losers) {
    const p = state.players.find((x) => x.userId === loser.userId)!;
    p.stack = Math.max(0, p.stack - loser.loss);
  }

  // Add gains to winner stack
  const winner = state.players.find((p) => p.userId === winnerId)!;
  winner.stack += totalLoss;

  const result: RummyHandResult = {
    winnerId,
    winnerGain: totalLoss,
    losers,
  };

  return { ok: true, state, handOver: true, result };
}

// ─── Timeout / auto-skip ──────────────────────────────────────────────────────

/**
 * When the turn clock expires: skip the seat per online points-rummy norms —
 * auto-draw from the closed deck (if needed), then discard that card so the
 * turn passes. If the player already drew, discard the last card in hand.
 * Only falls back to drop when no legal draw/discard is possible.
 */
export function applyTimeoutSkip(
  state: RummyHandState,
  userId: number,
): RummyActionResult {
  if (state.phase !== "playing") {
    return { ok: false, error: "Hand is not in playing phase" };
  }

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { ok: false, error: "Player not in hand" };
  if (state.actingSeat !== player.seatIndex) {
    return { ok: false, error: "Not your turn" };
  }
  if (player.dropped) return { ok: false, error: "You have already dropped" };

  let discardCard: Card | undefined;

  if (!player.drew) {
    if (state.closedDeck.length === 0) {
      if (state.discardPile.length <= 1) {
        // Cannot complete a legal skip — drop as last resort.
        return applyAction(state, userId, { type: "drop" });
      }
      const top = state.discardPile.pop()!;
      state.closedDeck = shuffleDeck(state.discardPile);
      state.discardPile = [top];
    }
    const drawn = state.closedDeck.pop()!;
    player.hand.push(drawn);
    player.drew = true;
    // Pure skip: put back the auto-drawn card.
    discardCard = drawn;
  } else {
    discardCard = player.hand[player.hand.length - 1];
  }

  if (!discardCard) {
    return { ok: false, error: "No card to discard on timeout" };
  }

  const idx = player.hand.lastIndexOf(discardCard);
  if (idx < 0) return { ok: false, error: `Card ${discardCard} not in hand` };
  player.hand.splice(idx, 1);
  state.discardPile.push(discardCard);
  player.drew = false;
  state.actingSeat = nextSeat(state, player.seatIndex);
  return { ok: true, state, handOver: false };
}

/** @deprecated Prefer applyTimeoutSkip — kept for call-site compatibility. */
export function timeoutAction(
  state: RummyHandState,
  userId: number,
): RummyActionInput {
  // Signal intent only; service should use applyTimeoutSkip for a full skip.
  const player = state.players.find((p) => p.userId === userId);
  if (player?.drew && player.hand.length > 0) {
    return { type: "discard", card: player.hand[player.hand.length - 1] };
  }
  return { type: "draw_closed" };
}

// ─── Public view ──────────────────────────────────────────────────────────────

export function publicPlayerView(
  p: RummyPlayer,
  viewerUserId: number | null,
  handOver: boolean,
) {
  const showCards = handOver || p.userId === viewerUserId;
  return {
    userId: p.userId,
    seatIndex: p.seatIndex,
    stack: p.userId === viewerUserId ? p.stack : 0,
    cardCount: p.hand.length,
    hand: showCards ? p.hand : null,
    drew: p.drew,
    dropped: p.dropped,
    dropPenalty: p.dropped ? p.dropPenalty : null,
    declaredValid: p.declaredValid,
    finalPoints: handOver ? p.finalPoints : null,
  };
}
