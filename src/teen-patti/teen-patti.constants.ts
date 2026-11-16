export const TP_TABLE_STATUS = {
  OPEN: "open",
  FROZEN: "frozen",
  DISABLED: "disabled",
} as const;

export const TP_SEAT_STATUS = {
  SEATED: "seated",
  LEFT: "left",
} as const;

export const TP_HAND_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export const TP_TURN_TIMEOUT_MS = 30_000;
