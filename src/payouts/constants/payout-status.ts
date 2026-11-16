export const PAYOUT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  CONFIRMING: "confirming",
  CONFIRMED: "confirmed",
  FAILED: "failed",
} as const;

export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];

export function normalizePayoutStatus(status: string): PayoutStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "confirmed" || normalized === "complete" || normalized === "completed") {
    return PAYOUT_STATUS.CONFIRMED;
  }
  if (normalized === "failed" || normalized === "rejected" || normalized === "canceled" || normalized === "cancelled") {
    return PAYOUT_STATUS.FAILED;
  }
  if (normalized === "confirming") {
    return PAYOUT_STATUS.CONFIRMING;
  }
  if (normalized === "processing" || normalized === "pending") {
    return PAYOUT_STATUS.PROCESSING;
  }
  return PAYOUT_STATUS.PROCESSING;
}
