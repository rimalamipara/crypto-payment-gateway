export type ColorName = "red" | "green" | "violet";
export type BetType = "color" | "number";

export function colorsForNumber(n: number): ColorName[] {
  if (n === 0) return ["violet", "red"];
  if (n === 5) return ["violet", "green"];
  if ([1, 3, 7, 9].includes(n)) return ["green"];
  if ([2, 4, 6, 8].includes(n)) return ["red"];
  throw new Error(`Invalid result number: ${n}`);
}

export function colorsToString(colors: ColorName[]): string {
  return colors.join(",");
}

/** House takes this fraction of the win profit (gross payout − stake). */
export const COLOR_WIN_FEE_RATE = 0.1;

/**
 * Gross multiplier payout (includes stake), before the 10% win fee.
 */
function grossPayout(
  betType: BetType,
  selection: string,
  stake: number,
  resultNumber: number,
): number {
  const colors = colorsForNumber(resultNumber);

  if (betType === "number") {
    if (selection !== String(resultNumber)) return 0;
    return stake * 9;
  }

  const color = selection as ColorName;
  if (!colors.includes(color)) return 0;

  if (color === "violet") return stake * 4.5;

  // Solid red/green: 2x normally; 1.5x when result is 0 or 5 (shared with violet)
  if (resultNumber === 0 || resultNumber === 5) return stake * 1.5;
  return stake * 2;
}

/**
 * Net credit to wallet for a winning bet (0 if lost).
 * Multipliers are WinGo-style, then 10% is cut from the win profit.
 * Example: $1 red/green win → gross $2 → fee $0.10 → payout $1.90.
 */
export function calcPayout(
  betType: BetType,
  selection: string,
  amountUsd: number,
  resultNumber: number,
): number {
  const stake = amountUsd;
  const gross = grossPayout(betType, selection, stake, resultNumber);
  if (gross <= 0) return 0;

  const profit = Math.max(0, gross - stake);
  const fee = profit * COLOR_WIN_FEE_RATE;
  return roundMoney(gross - fee);
}

export type PendingBetLike = {
  betType: string;
  selection: string;
  amountUsd: string | number;
};

/**
 * Pick the digit 0–9 that minimizes total player payouts (max house profit).
 * Ties broken by lower total payout, then by random among equal minima so
 * the pattern is not always the same digit.
 */
export function pickProfitMaximizingResult(
  bets: PendingBetLike[],
  randomPick: (exclusiveMax: number) => number = (n) =>
    Math.floor(Math.random() * n),
): number {
  if (bets.length === 0) {
    return randomPick(10);
  }

  let bestPayout = Number.POSITIVE_INFINITY;
  const winners: number[] = [];

  for (let n = 0; n <= 9; n++) {
    let total = 0;
    for (const bet of bets) {
      total += calcPayout(
        bet.betType as BetType,
        bet.selection,
        Number(bet.amountUsd),
        n,
      );
    }
    total = roundMoney(total);
    if (total < bestPayout - 1e-9) {
      bestPayout = total;
      winners.length = 0;
      winners.push(n);
    } else if (Math.abs(total - bestPayout) <= 1e-9) {
      winners.push(n);
    }
  }

  return winners[randomPick(winners.length)] ?? 0;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isValidSelection(betType: BetType, selection: string): boolean {
  if (betType === "color") {
    return selection === "red" || selection === "green" || selection === "violet";
  }
  if (betType === "number") {
    const n = Number(selection);
    return Number.isInteger(n) && n >= 0 && n <= 9 && selection === String(n);
  }
  return false;
}

/** Full period length: 3 minutes. */
export const ROUND_MS = 3 * 60_000;
/** Last 30s are locked (no new bets) — betting open for 2.5 minutes. */
export const LOCK_MS = 30_000;

/**
 * Period display name: year month date hour minute periodCount (no separators)
 * e.g. 20261027192140
 */
export function formatPeriodName(
  startsAt: string | Date,
  periodNo: number,
): string {
  const d = new Date(startsAt);
  if (!Number.isFinite(d.getTime())) return String(periodNo);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}${mo}${day}${h}${mi}${periodNo}`;
}
