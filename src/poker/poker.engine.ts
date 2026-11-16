/**
 * No-Limit Texas Hold'em + Omaha (high) cash-game engine.
 * Rules source: poker rules specification §§1–12.
 *
 * External amounts are USD with 2dp (wallet-compatible). Internally all
 * chip math uses integer cents to satisfy §1 / §12.
 */

import { randomBytes } from "node:crypto";

import {
  compareHands,
  evaluateBestHand,
  RANKS,
  SUITS,
  type ScoredHand,
} from "./poker.eval.ts";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type PokerActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in";
export type PokerVariant = "holdem" | "omaha";

export interface EnginePlayer {
  userId: number;
  seatIndex: number;
  /** Remaining stack in USD (2dp). */
  stack: number;
  holeCards: string[];
  betStreet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  /** currentBet (USD) when this player last acted voluntarily this street; null = not yet. */
  betLevelWhenLastActed: number | null;
  actedThisStreet: boolean;
}

export interface SidePot {
  amount: number;
  eligibleUserIds: number[];
}

export interface HandResult {
  winners: Array<{ userId: number; amount: number; handRank?: string }>;
  rake: number;
  pot: number;
  board: string[];
  sidePots: SidePot[];
}

export interface PokerEngineConfig {
  /** §2.4 burn before flop/turn/river. Default on. */
  burnCards: boolean;
  /** §5.2 fold when toCall=0. Default reject. */
  allowFoldWhenCheck: boolean;
  /** §4.2 show all active hands on all-in runout. Default on. */
  showAllOnAllInRunout: boolean;
  /** §10.10 / computeRake: no flop no drop. Default on. */
  noFlopNoDrop: boolean;
}

export const DEFAULT_ENGINE_CONFIG: PokerEngineConfig = {
  burnCards: true,
  allowFoldWhenCheck: false,
  showAllOnAllInRunout: true,
  noFlopNoDrop: true,
};

export interface TableHandState {
  handId: number;
  handNo: number;
  street: Street;
  board: string[];
  deck: string[];
  pot: number;
  currentBet: number;
  /** §5.5 last FULL raise increment size (USD). */
  lastFullRaiseSize: number;
  /** @deprecated alias of lastFullRaiseSize for older callers */
  minRaise: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actingSeat: number | null;
  players: EnginePlayer[];
  actionHistory: Array<{
    userId: number;
    street: Street;
    action: PokerActionType;
    amount: number;
  }>;
  smallBlind: number;
  bigBlind: number;
  rakePercent: number;
  rakeCap: number;
  startedAt: string;
  variant: PokerVariant;
  config: PokerEngineConfig;
  /** Starting stacks sum (USD) for conservation checks. */
  startingChips: number;
}

// ── Money (cents) ────────────────────────────────────────────────────────────

function toCents(usd: number): number {
  // Avoid IEEE edge cases like 1.005 * 100 → 100.4999…
  return Math.round(Number(usd) * 100 + Number.EPSILON);
}
function toUsd(cents: number): number {
  return Math.round(cents) / 100;
}
/** Round USD to nearest cent. */
export function money(n: number): number {
  return toUsd(toCents(n));
}

// ── Deck ─────────────────────────────────────────────────────────────────────

export function createDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) deck.push(`${r}${s}`);
  }
  return deck;
}

/** Fisher–Yates with CSPRNG (§2.2). */
export function shuffleDeck(deck: string[]): string[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const buf = randomBytes(4);
    const j = buf.readUInt32BE(0) % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// Re-export eval helpers for tests
export {
  evaluateBestHand,
  evaluateHoldem,
  evaluateOmaha,
  scoreFive,
  compareHands,
} from "./poker.eval.ts";
export type { ScoredHand };

// ── Seat helpers ─────────────────────────────────────────────────────────────

function nextOccupiedSeat(
  players: EnginePlayer[],
  fromSeat: number,
  predicate: (p: EnginePlayer) => boolean = () => true,
): number | null {
  const seats = players
    .filter((p) => !p.sittingOut)
    .map((p) => p.seatIndex)
    .sort((a, b) => a - b);
  if (seats.length === 0) return null;
  let idx = seats.indexOf(fromSeat);
  if (idx < 0) {
    // fromSeat may be a dead button (empty). Start just after it.
    idx = seats.findIndex((s) => s > fromSeat);
    if (idx < 0) idx = 0;
    else idx = (idx - 1 + seats.length) % seats.length;
  }
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(idx + offset) % seats.length];
    if (seat === undefined) continue;
    const p = players.find((x) => x.seatIndex === seat);
    if (p && predicate(p)) return seat;
  }
  return null;
}

function playerAt(state: TableHandState, seat: number): EnginePlayer | undefined {
  return state.players.find((p) => p.seatIndex === seat);
}

function activePlayers(state: TableHandState): EnginePlayer[] {
  return state.players.filter((p) => !p.folded && !p.sittingOut);
}

function canAct(p: EnginePlayer): boolean {
  return !p.folded && !p.allIn && !p.sittingOut && toCents(p.stack) > 0;
}

function holeCount(variant: PokerVariant): number {
  return variant === "omaha" ? 4 : 2;
}

// ── Start hand ───────────────────────────────────────────────────────────────

export function startHand(input: {
  handId: number;
  handNo: number;
  seats: Array<{ userId: number; seatIndex: number; stack: number }>;
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  rakePercent: number;
  rakeCap: number;
  variant?: PokerVariant;
  config?: Partial<PokerEngineConfig>;
  /** Test hook: pre-ordered deck (deal via pop from end). */
  deck?: string[];
}): TableHandState {
  const config: PokerEngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    ...input.config,
  };
  const variant: PokerVariant = input.variant ?? "holdem";
  const holes = holeCount(variant);

  const seated = input.seats
    .filter((s) => toCents(s.stack) > 0)
    .map(
      (s): EnginePlayer => ({
        userId: s.userId,
        seatIndex: s.seatIndex,
        stack: money(s.stack),
        holeCards: [],
        betStreet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        sittingOut: false,
        betLevelWhenLastActed: null,
        actedThisStreet: false,
      }),
    );

  if (seated.length < 2) {
    throw new Error("Need at least 2 players with chips to start a hand");
  }

  // §2.6 capacity
  const burns = config.burnCards ? 3 : 0;
  const needed = seated.length * holes + 5 + burns;
  if (needed > 52) {
    throw new Error(
      `Too many players for ${variant}: need ${needed} cards, deck has 52`,
    );
  }

  const seatsSorted = seated.map((p) => p.seatIndex).sort((a, b) => a - b);
  let dealerSeat = input.dealerSeat;
  // Allow dead button (seat not occupied) — keep as-is if between seats
  if (
    !seatsSorted.includes(dealerSeat) &&
    !seated.some((p) => p.seatIndex === dealerSeat)
  ) {
    // If completely invalid (e.g. first hand), pick first seat
    if (
      dealerSeat < seatsSorted[0]! - 20 ||
      dealerSeat > seatsSorted[seatsSorted.length - 1]! + 20
    ) {
      dealerSeat = seatsSorted[0]!;
    }
  }

  const headsUp = seated.length === 2;
  // §3.3 / §3.4
  const sbSeat = headsUp
    ? seatsSorted.includes(dealerSeat)
      ? dealerSeat
      : seatsSorted[0]!
    : nextOccupiedSeat(seated, dealerSeat)!;
  const bbSeat = nextOccupiedSeat(seated, sbSeat)!;

  let deck = input.deck ? [...input.deck] : shuffleDeck(createDeck());

  // §2.3 one-at-a-time clockwise from SB
  for (let round = 0; round < holes; round += 1) {
    let seat: number | null = sbSeat;
    for (let i = 0; i < seated.length; i += 1) {
      const p = seated.find((x) => x.seatIndex === seat);
      if (!p || seat == null) break;
      const card = deck.pop();
      if (!card) throw new Error("Deck exhausted while dealing");
      p.holeCards.push(card);
      seat = nextOccupiedSeat(seated, seat);
    }
  }

  const startingChips = money(
    seated.reduce((s, p) => s + p.stack, 0),
  );

  const state: TableHandState = {
    handId: input.handId,
    handNo: input.handNo,
    street: "preflop",
    board: [],
    deck,
    pot: 0,
    currentBet: 0,
    lastFullRaiseSize: money(input.bigBlind),
    minRaise: money(input.bigBlind),
    dealerSeat,
    smallBlindSeat: sbSeat,
    bigBlindSeat: bbSeat,
    actingSeat: null,
    players: seated,
    actionHistory: [],
    smallBlind: money(input.smallBlind),
    bigBlind: money(input.bigBlind),
    rakePercent: input.rakePercent,
    rakeCap: input.rakeCap,
    startedAt: new Date().toISOString(),
    variant,
    config,
    startingChips,
  };

  postBlind(state, sbSeat, state.smallBlind);
  postBlind(state, bbSeat, state.bigBlind);

  // §5.10 short BB: current bet to call is still full BB
  state.currentBet = state.bigBlind;
  state.lastFullRaiseSize = state.bigBlind;
  state.minRaise = state.bigBlind;

  // Blinds are not voluntary actions (§5.9)
  for (const p of state.players) {
    p.actedThisStreet = false;
    p.betLevelWhenLastActed = null;
  }

  // §5.1 / §3.4 first to act
  const first = headsUp
    ? nextOccupiedSeat(state.players, bbSeat, canAct) // BTN/SB acts first HU preflop = seat after BB going around = BTN
    : nextOccupiedSeat(state.players, bbSeat, canAct);
  // Heads-up: button is SB; nextOccupied from BB lands on button — correct.
  state.actingSeat = first;

  return state;
}

function postBlind(state: TableHandState, seat: number, amount: number): void {
  const p = playerAt(state, seat);
  if (!p) return;
  const pay = money(Math.min(p.stack, amount));
  p.stack = money(p.stack - pay);
  p.betStreet = money(p.betStreet + pay);
  p.totalBet = money(p.totalBet + pay);
  state.pot = money(state.pot + pay);
  if (toCents(p.stack) === 0) p.allIn = true;
  state.actionHistory.push({
    userId: p.userId,
    street: state.street,
    action: p.allIn ? "all_in" : "bet",
    amount: pay,
  });
}

// ── Legal actions (§5.2, 5.7) ────────────────────────────────────────────────

function mayRaise(state: TableHandState, p: EnginePlayer): boolean {
  if (!canAct(p)) return false;
  if (!p.actedThisStreet || p.betLevelWhenLastActed === null) return true;
  const faced = money(state.currentBet - p.betLevelWhenLastActed);
  return faced + 1e-9 >= state.lastFullRaiseSize;
}

export function legalActions(
  state: TableHandState,
  userId: number,
): {
  actions: PokerActionType[];
  callAmount: number;
  minBet: number;
  minRaiseTo: number;
  maxBet: number;
} {
  const p = state.players.find((x) => x.userId === userId);
  if (!p || state.actingSeat !== p.seatIndex || !canAct(p)) {
    return { actions: [], callAmount: 0, minBet: 0, minRaiseTo: 0, maxBet: 0 };
  }

  const toCall = money(Math.max(0, state.currentBet - p.betStreet));
  const maxBet = money(p.stack + p.betStreet);
  const actions: PokerActionType[] = [];

  if (toCall === 0) {
    if (state.config.allowFoldWhenCheck) actions.push("fold");
    actions.push("check");
    if (toCents(p.stack) > 0) {
      // Matched current bet but street already has a bet (e.g. BB option) → raise
      if (toCents(state.currentBet) > 0) actions.push("raise");
      else actions.push("bet");
      actions.push("all_in");
    }
  } else {
    actions.push("fold");
    if (toCents(p.stack) <= toCents(toCall)) {
      actions.push("all_in"); // call all-in
    } else {
      actions.push("call");
      if (mayRaise(state, p)) {
        actions.push("raise");
        actions.push("all_in");
      } else {
        // Can still shove if stack > toCall (incomplete raise) when mayRaise —
        // if mayRaise is false, only fold/call. But all-in for more than call
        // when betting not reopened is NOT allowed for players who already acted.
        // Spec 5.7: fold or call the extra only.
      }
    }
  }

  // Special: stack between call and min-raise → fold, call, or all-in (incomplete)
  if (
    toCall > 0 &&
    toCents(p.stack) > toCents(toCall) &&
    mayRaise(state, p) &&
    !actions.includes("all_in")
  ) {
    actions.push("all_in");
  }

  const minRaiseTo = money(state.currentBet + state.lastFullRaiseSize);
  const minBet = state.bigBlind;

  return {
    actions: [...new Set(actions)],
    callAmount: toCall,
    minBet,
    minRaiseTo,
    maxBet,
  };
}

// ── Apply action ─────────────────────────────────────────────────────────────

export type ApplyActionResult =
  | { ok: true; state: TableHandState; handOver: boolean; result?: HandResult }
  | { ok: false; error: string };

export function applyAction(
  state: TableHandState,
  userId: number,
  action: PokerActionType,
  amount?: number,
): ApplyActionResult {
  const p = state.players.find((x) => x.userId === userId);
  if (!p) return { ok: false, error: "Player not in hand" };
  if (state.street === "showdown") {
    return { ok: false, error: "Hand is finished" };
  }
  if (state.actingSeat !== p.seatIndex) return { ok: false, error: "Not your turn" };
  if (!canAct(p)) return { ok: false, error: "Cannot act" };

  const legal = legalActions(state, userId);
  if (!legal.actions.includes(action)) {
    return { ok: false, error: `Illegal action: ${action}` };
  }

  if (action === "fold") {
    if (legal.callAmount === 0 && !state.config.allowFoldWhenCheck) {
      return { ok: false, error: "Cannot fold when check is available" };
    }
    p.folded = true;
    markActed(p, state.currentBet);
    state.actionHistory.push({
      userId,
      street: state.street,
      action: "fold",
      amount: 0,
    });
  } else if (action === "check") {
    if (legal.callAmount > 0) {
      return { ok: false, error: "Cannot check when facing a bet" };
    }
    markActed(p, state.currentBet);
    state.actionHistory.push({
      userId,
      street: state.street,
      action: "check",
      amount: 0,
    });
  } else if (action === "call") {
    const pay = money(Math.min(p.stack, legal.callAmount));
    commitChips(state, p, pay);
    markActed(p, state.currentBet);
    state.actionHistory.push({
      userId,
      street: state.street,
      action: p.allIn ? "all_in" : "call",
      amount: pay,
    });
  } else if (action === "bet" || action === "raise" || action === "all_in") {
    let target = amount !== undefined ? money(amount) : 0;
    if (action === "all_in") {
      target = money(p.stack + p.betStreet);
    }

    if (action === "bet") {
      if (state.currentBet > 0) {
        return { ok: false, error: "Cannot bet when facing a bet; raise instead" };
      }
      if (
        toCents(target) < toCents(legal.minBet) &&
        toCents(target) < toCents(p.stack + p.betStreet)
      ) {
        return { ok: false, error: `Min bet is ${legal.minBet}` };
      }
    }

    if (action === "raise") {
      // Opening raise when already matched (BB option / limp-around) is allowed
      // even though toCall=0; mayRaise still applies for reopen rules.
      if (toCents(legal.callAmount) > 0 && !mayRaise(state, p)) {
        return { ok: false, error: "Betting is not reopened for a raise" };
      }
      const minTo =
        toCents(state.currentBet) === 0
          ? legal.minBet
          : legal.minRaiseTo;
      if (
        toCents(target) < toCents(minTo) &&
        toCents(target) < toCents(p.stack + p.betStreet)
      ) {
        return { ok: false, error: `Min raise to ${minTo}` };
      }
    }

    const maxTo = money(p.stack + p.betStreet);
    if (toCents(target) > toCents(maxTo)) target = maxTo;
    const pay = money(target - p.betStreet);
    if (toCents(pay) <= 0) return { ok: false, error: "Invalid bet amount" };

    const prevCurrent = state.currentBet;
    const raiseBy = money(target - prevCurrent);
    commitChips(state, p, pay);

    if (toCents(target) > toCents(prevCurrent)) {
      // Full raise? (§5.5 / §5.7)
      if (toCents(raiseBy) >= toCents(state.lastFullRaiseSize)) {
        state.lastFullRaiseSize = raiseBy;
        state.minRaise = raiseBy;
      }
      // Incomplete all-in raise: currentBet rises, lastFullRaiseSize unchanged
      state.currentBet = target;
    }

    markActed(p, state.currentBet);
    state.actionHistory.push({
      userId,
      street: state.street,
      action: p.allIn ? "all_in" : action,
      amount: pay,
    });
  }

  return advanceAfterAction(state);
}

/**
 * Fold a non–all-in player even when it is not their turn (mid-hand leave).
 * Routes through advanceAfterAction so uncontested pots / street completion run.
 * All-in players must never be folded (spec 10.7).
 */
export function forceFold(
  state: TableHandState,
  userId: number,
): ApplyActionResult {
  const p = state.players.find((x) => x.userId === userId);
  if (!p) return { ok: false, error: "Player not in hand" };
  if (p.folded) return { ok: true, state, handOver: false };
  if (p.allIn) return { ok: false, error: "Cannot fold an all-in player" };
  if (state.street === "showdown") {
    return { ok: false, error: "Hand is finished" };
  }

  p.folded = true;
  markActed(p, state.currentBet);
  state.actionHistory.push({
    userId,
    street: state.street,
    action: "fold",
    amount: 0,
  });

  // If they were acting, advance as usual; if not, still re-evaluate the round.
  return advanceAfterAction(state);
}

function markActed(p: EnginePlayer, currentBet: number): void {
  p.actedThisStreet = true;
  p.betLevelWhenLastActed = currentBet;
}

function commitChips(
  state: TableHandState,
  p: EnginePlayer,
  pay: number,
): void {
  const actual = money(Math.min(p.stack, pay));
  p.stack = money(p.stack - actual);
  p.betStreet = money(p.betStreet + actual);
  p.totalBet = money(p.totalBet + actual);
  state.pot = money(state.pot + actual);
  if (toCents(p.stack) === 0) p.allIn = true;
}

// ── Betting round end (§5.11) ────────────────────────────────────────────────

function bettingRoundComplete(state: TableHandState): boolean {
  const actors = activePlayers(state).filter(canAct);
  if (actors.length === 0) return true;

  // Everyone who can act must match currentBet
  for (const p of actors) {
    if (toCents(p.betStreet) !== toCents(state.currentBet)) return false;
  }

  // Everyone who can act must have acted voluntarily this street
  for (const p of actors) {
    if (!p.actedThisStreet) return false;
  }

  return true;
}

function advanceAfterAction(state: TableHandState): ApplyActionResult {
  const remaining = activePlayers(state);
  if (remaining.length === 1) {
    const winner = remaining[0]!;
    const result = awardUncontested(state, winner);
    return { ok: true, state, handOver: true, result };
  }

  if (!bettingRoundComplete(state)) {
    const next = nextOccupiedSeat(
      state.players,
      state.actingSeat ?? state.dealerSeat,
      canAct,
    );
    state.actingSeat = next;
    // Safety: if somehow no next actor but round not complete, force complete
    if (next === null) {
      return finishStreetOrShowdown(state);
    }
    return { ok: true, state, handOver: false };
  }

  return finishStreetOrShowdown(state);
}

function finishStreetOrShowdown(state: TableHandState): ApplyActionResult {
  resetStreetBets(state);

  const actorsLeft = () => activePlayers(state).filter(canAct).length;
  const activeLeft = () => activePlayers(state).length;

  const dealNextStreet = (): boolean => {
    if (state.street === "preflop") {
      dealCommunity(state, 3);
      state.street = "flop";
      return true;
    }
    if (state.street === "flop") {
      dealCommunity(state, 1);
      state.street = "turn";
      return true;
    }
    if (state.street === "turn") {
      dealCommunity(state, 1);
      state.street = "river";
      return true;
    }
    if (state.street === "river") {
      state.street = "showdown";
      return false;
    }
    return false;
  };

  // §4.2: fewer than 2 can-act → run out board
  if (actorsLeft() <= 1 && activeLeft() >= 2) {
    while (state.board.length < 5) {
      if (state.board.length < 3) dealCommunity(state, 3 - state.board.length);
      else dealCommunity(state, 1);
    }
    state.street = "showdown";
    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  if (state.street === "river") {
    state.street = "showdown";
    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  dealNextStreet();

  if (actorsLeft() <= 1 && activeLeft() >= 2) {
    while (state.board.length < 5) {
      if (state.board.length < 3) dealCommunity(state, 3 - state.board.length);
      else dealCommunity(state, 1);
    }
    state.street = "showdown";
    const result = resolveShowdown(state);
    return { ok: true, state, handOver: true, result };
  }

  state.currentBet = 0;
  state.lastFullRaiseSize = state.bigBlind;
  state.minRaise = state.bigBlind;
  for (const p of state.players) {
    p.actedThisStreet = false;
    p.betLevelWhenLastActed = null;
  }

  // Postflop first actor: left of button (§5.1); HU: BB first (§3.4)
  state.actingSeat = nextOccupiedSeat(
    state.players,
    state.dealerSeat,
    canAct,
  );
  return { ok: true, state, handOver: false };
}

function resetStreetBets(state: TableHandState): void {
  for (const p of state.players) {
    p.betStreet = 0;
  }
}

function dealCommunity(state: TableHandState, count: number): void {
  if (state.config.burnCards) {
    const burn = state.deck.pop();
    void burn;
  }
  for (let i = 0; i < count; i += 1) {
    const card = state.deck.pop();
    if (!card) throw new Error("Deck exhausted dealing community");
    state.board.push(card);
  }
}

// ── Uncalled bets & side pots (§5.12, §6) ────────────────────────────────────

/** Return unmatched portion of the highest contribution (§5.12). */
export function returnUncalledBets(state: TableHandState): number {
  const dealt = state.players.filter((p) => p.totalBet > 0 || !p.sittingOut);
  if (dealt.length === 0) return 0;
  const sorted = [...dealt].sort(
    (a, b) => toCents(b.totalBet) - toCents(a.totalBet),
  );
  const high = sorted[0]!;
  const second = sorted[1]?.totalBet ?? 0;
  const uncalled = money(high.totalBet - second);
  if (toCents(uncalled) <= 0) return 0;
  high.stack = money(high.stack + uncalled);
  high.totalBet = money(high.totalBet - uncalled);
  state.pot = money(Math.max(0, state.pot - uncalled));
  return uncalled;
}

/**
 * §6.3 side-pot algorithm.
 * levels from ACTIVE (non-folded) contributions; amounts from ALL dealt-in.
 */
export function buildSidePots(players: EnginePlayer[]): SidePot[] {
  const dealt = players.filter((p) => !p.sittingOut);
  const active = dealt.filter((p) => !p.folded);
  const levels = [
    ...new Set(active.map((p) => money(p.totalBet)).filter((v) => v > 0)),
  ].sort((a, b) => toCents(a) - toCents(b));

  const pots: SidePot[] = [];
  let prev = 0;
  for (const L of levels) {
    let amountCents = 0;
    for (const p of dealt) {
      const c = toCents(p.totalBet);
      const layer = Math.max(0, Math.min(c, toCents(L)) - Math.min(c, toCents(prev)));
      amountCents += layer;
    }
    const eligible = active
      .filter((p) => toCents(p.totalBet) >= toCents(L))
      .map((p) => p.userId)
      .sort((a, b) => a - b);
    const amount = toUsd(amountCents);
    if (amountCents > 0 && eligible.length > 0) {
      pots.push({ amount, eligibleUserIds: eligible });
    }
    prev = L;
  }

  // Merge consecutive pots with identical eligible sets (§6.3)
  const merged: SidePot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.eligibleUserIds.length === pot.eligibleUserIds.length &&
      last.eligibleUserIds.every((id, i) => id === pot.eligibleUserIds[i])
    ) {
      last.amount = money(last.amount + pot.amount);
    } else {
      merged.push({ ...pot, eligibleUserIds: [...pot.eligibleUserIds] });
    }
  }
  return merged;
}

function awardUncontested(
  state: TableHandState,
  winner: EnginePlayer,
): HandResult {
  returnUncalledBets(state);
  const sawFlop = state.board.length >= 3;
  const rake = computeRake(
    state.pot,
    state.rakePercent,
    state.rakeCap,
    false, // uncontested — typically no rake; also no-flop-no-drop
    sawFlop,
    state.config.noFlopNoDrop,
  );
  const potBefore = state.pot;
  const awarded = money(state.pot - rake);
  winner.stack = money(winner.stack + awarded);
  state.pot = 0;
  state.street = "showdown";
  return {
    winners: [{ userId: winner.userId, amount: awarded }],
    rake,
    pot: potBefore,
    board: [...state.board],
    sidePots: [{ amount: potBefore, eligibleUserIds: [winner.userId] }],
  };
}

export function computeRake(
  pot: number,
  rakePercent: number,
  rakeCap: number,
  contested: boolean,
  sawFlop = true,
  noFlopNoDrop = true,
): number {
  if (!contested || toCents(pot) <= 0) return 0;
  if (noFlopNoDrop && !sawFlop) return 0;
  const raw = toCents((pot * rakePercent) / 100);
  const cap = toCents(rakeCap);
  return toUsd(Math.min(raw, cap > 0 ? cap : raw));
}

function resolveShowdown(state: TableHandState): HandResult {
  returnUncalledBets(state);
  const sidePots = buildSidePots(state.players);
  const winnersMap = new Map<number, { amount: number; handRank?: string }>();

  const evals = new Map<number, ScoredHand>();
  for (const p of activePlayers(state)) {
    evals.set(
      p.userId,
      evaluateBestHand(p.holeCards, state.board, state.variant),
    );
  }

  const seatsClockwiseFromButton = () => {
    const seats = state.players
      .map((p) => p.seatIndex)
      .sort((a, b) => a - b);
    const order: number[] = [];
    let seat = nextOccupiedSeat(state.players, state.dealerSeat);
    for (let i = 0; i < seats.length; i += 1) {
      if (seat == null) break;
      order.push(seat);
      seat = nextOccupiedSeat(state.players, seat);
    }
    return order;
  };

  for (const pot of sidePots) {
    if (pot.eligibleUserIds.length === 0) continue;
    // §6.6 single eligible — award without comparison
    if (pot.eligibleUserIds.length === 1) {
      const uid = pot.eligibleUserIds[0]!;
      const prev = winnersMap.get(uid) ?? { amount: 0 };
      winnersMap.set(uid, {
        amount: money(prev.amount + pot.amount),
        handRank: evals.get(uid)?.name,
      });
      continue;
    }

    const scored = pot.eligibleUserIds.map((uid) => ({
      userId: uid,
      hand: evals.get(uid)!,
      seatIndex: state.players.find((p) => p.userId === uid)!.seatIndex,
    }));
    scored.sort((a, b) => compareHands(b.hand, a.hand));
    const best = scored[0]!.hand;
    const tied = scored.filter((s) => compareHands(s.hand, best) === 0);

    // §8.6 odd chips: leftover units clockwise from left of button
    const potCents = toCents(pot.amount);
    const share = Math.floor(potCents / tied.length);
    let remainder = potCents - share * tied.length;
    const cw = seatsClockwiseFromButton();
    tied.sort((a, b) => {
      const ia = cw.indexOf(a.seatIndex);
      const ib = cw.indexOf(b.seatIndex);
      return ia - ib;
    });

    tied.forEach((t, idx) => {
      let cents = share;
      if (remainder > 0) {
        cents += 1;
        remainder -= 1;
      }
      void idx;
      const prev = winnersMap.get(t.userId) ?? { amount: 0 };
      winnersMap.set(t.userId, {
        amount: money(prev.amount + toUsd(cents)),
        handRank: t.hand.name,
      });
    });
  }

  const totalPot = money(sidePots.reduce((s, p) => s + p.amount, 0));
  const contested = activePlayers(state).length > 1;
  const rake = computeRake(
    totalPot,
    state.rakePercent,
    state.rakeCap,
    contested,
    state.board.length >= 3,
    state.config.noFlopNoDrop,
  );

  const winners = [...winnersMap.entries()].map(([userId, w]) => ({
    userId,
    amount: w.amount,
    handRank: w.handRank,
  }));

  if (toCents(rake) > 0 && winners.length > 0) {
    let rakeLeft = toCents(rake);
    const totalWin = winners.reduce((s, w) => s + toCents(w.amount), 0);
    winners.forEach((w, idx) => {
      const cut =
        idx === winners.length - 1
          ? rakeLeft
          : Math.floor((toCents(w.amount) / totalWin) * toCents(rake));
      rakeLeft -= cut;
      w.amount = toUsd(Math.max(0, toCents(w.amount) - cut));
    });
  }

  for (const w of winners) {
    const p = state.players.find((x) => x.userId === w.userId);
    if (p) p.stack = money(p.stack + w.amount);
  }
  // Chips left the pot into stacks (rake removed from play).
  state.pot = 0;

  return {
    winners,
    rake,
    pot: totalPot,
    board: [...state.board],
    sidePots,
  };
}

/** Auto-action on timeout: check if free, else fold (§11.1). */
export function timeoutAction(
  state: TableHandState,
  userId: number,
): { action: PokerActionType; amount?: number } {
  const legal = legalActions(state, userId);
  if (legal.actions.includes("check")) return { action: "check" };
  if (legal.actions.includes("fold")) return { action: "fold" };
  return { action: "check" };
}

export function publicPlayerView(
  p: EnginePlayer,
  viewerUserId: number | null,
  handOver: boolean,
): {
  userId: number;
  seatIndex: number;
  stack: number;
  betStreet: number;
  folded: boolean;
  allIn: boolean;
  holeCards: string[] | null;
} {
  const show =
    handOver || p.userId === viewerUserId ? p.holeCards : null;
  return {
    userId: p.userId,
    seatIndex: p.seatIndex,
    stack: p.userId === viewerUserId ? p.stack : 0,
    betStreet: p.betStreet,
    folded: p.folded,
    allIn: p.allIn,
    holeCards: show,
  };
}

/** Chip conservation helper for tests (§12.1). */
export function totalChips(state: TableHandState): number {
  const stacks = state.players.reduce((s, p) => s + toCents(p.stack), 0);
  // pot already includes street bets that were committed
  return toUsd(stacks + toCents(state.pot));
}

void SUITS; // used via createDeck
