export interface RgSettings {
  dailyDepositLimitUsd: number | null;
  dailyLossLimitUsd: number | null;
  coolingOffUntil: Date | null;
  selfExcludedUntil: Date | null;
}

export const PERMANENT_EXCLUSION = new Date("9999-12-31T00:00:00Z");

/** Returns a block reason, or null if the user may wager now. */
export function playBlockReason(s: RgSettings, netLoss24h: number, now = new Date()): string | null {
  if (s.selfExcludedUntil && s.selfExcludedUntil > now) {
    return s.selfExcludedUntil.getTime() === PERMANENT_EXCLUSION.getTime()
      ? "You have permanently self-excluded"
      : `You are self-excluded until ${s.selfExcludedUntil.toISOString()}`;
  }
  if (s.coolingOffUntil && s.coolingOffUntil > now) {
    return `Cooling-off period active until ${s.coolingOffUntil.toISOString()}`;
  }
  if (s.dailyLossLimitUsd !== null && netLoss24h >= s.dailyLossLimitUsd) {
    return "Daily loss limit reached";
  }
  return null;
}

/** Returns a block reason, or null if depositing `amount` keeps the user within limits. */
export function depositBlockReason(
  s: RgSettings,
  deposited24h: number,
  amount: number,
  now = new Date(),
): string | null {
  if (s.selfExcludedUntil && s.selfExcludedUntil > now) return "You are self-excluded";
  if (s.dailyDepositLimitUsd !== null && deposited24h + amount > s.dailyDepositLimitUsd) {
    return "Daily deposit limit would be exceeded";
  }
  return null;
}
