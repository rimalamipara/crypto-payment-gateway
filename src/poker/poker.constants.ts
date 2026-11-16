export const POKER_TABLE_STATUS = {
  OPEN: "open",
  FROZEN: "frozen",
  DISABLED: "disabled",
} as const;

export const POKER_SEAT_STATUS = {
  SEATED: "seated",
  SITTING_OUT: "sitting_out",
  LEFT: "left",
} as const;

export const POKER_HAND_STATUS = {
  ACTIVE: "active",
  /** Claimed for cancel/refund; only the claimer may refund. */
  CANCELLING: "cancelling",
  /** Claimed for payout; must never go down the cancel path. */
  SETTLING: "settling",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export const TURN_TIMEOUT_MS = 30_000;
