export const RUMMY_TABLE_STATUS = {
  OPEN: "open",
  FROZEN: "frozen",
  DISABLED: "disabled",
} as const;

export const RUMMY_SEAT_STATUS = {
  SEATED: "seated",
  LEFT: "left",
} as const;

export const RUMMY_HAND_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

/** ms before a player's turn is auto-skipped (draw + discard) */
export const RUMMY_TURN_TIMEOUT_MS = 45_000;

/** Max points capped per player per hand */
export const RUMMY_MAX_POINTS = 80;

/** Fixed penalty points for an early drop (before drawing any card) */
export const RUMMY_EARLY_DROP_POINTS = 20;

/** Fixed penalty points for a middle drop */
export const RUMMY_MIDDLE_DROP_POINTS = 40;
