/** Default NLHE cash stake ladder (USD). */
export interface PokerStakeTemplate {
  /** Display label without instance suffix, e.g. NLHE 0.50/1.00 */
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakePercent: number;
  rakeCap: number;
}

export const POKER_STAKE_TEMPLATES: PokerStakeTemplate[] = [
  {
    name: "NLHE 0.05/0.10",
    smallBlind: 0.05,
    bigBlind: 0.1,
    minBuyIn: 2,
    maxBuyIn: 20,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 1,
  },
  {
    name: "NLHE 0.25/0.50",
    smallBlind: 0.25,
    bigBlind: 0.5,
    minBuyIn: 10,
    maxBuyIn: 100,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 2,
  },
  {
    name: "NLHE 0.50/1.00",
    smallBlind: 0.5,
    bigBlind: 1,
    minBuyIn: 20,
    maxBuyIn: 200,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 3,
  },
  {
    name: "NLHE 1/2",
    smallBlind: 1,
    bigBlind: 2,
    minBuyIn: 40,
    maxBuyIn: 400,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 4,
  },
  {
    name: "NLHE 2/5",
    smallBlind: 2,
    bigBlind: 5,
    minBuyIn: 100,
    maxBuyIn: 1000,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 6,
  },
  {
    name: "NLHE 5/10",
    smallBlind: 5,
    bigBlind: 10,
    minBuyIn: 200,
    maxBuyIn: 2000,
    maxSeats: 6,
    rakePercent: 5,
    rakeCap: 10,
  },
];

export function sameStakes(
  a: { smallBlind: string | number; bigBlind: string | number },
  b: { smallBlind: string | number; bigBlind: string | number },
): boolean {
  return Number(a.smallBlind) === Number(b.smallBlind)
    && Number(a.bigBlind) === Number(b.bigBlind);
}

export function stakeBaseName(smallBlind: number, bigBlind: number): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `NLHE ${fmt(smallBlind)}/${fmt(bigBlind)}`;
}
