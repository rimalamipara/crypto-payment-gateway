export const PAYMENT_STATUS = {
  NEW: "new",
  WAITING: "waiting",
  PAYING: "paying",
  PAID: "paid",
  MANUAL_ACCEPT: "manual_accept",
  UNDERPAID: "underpaid",
  REFUNDING: "refunding",
  REFUNDED: "refunded",
  EXPIRED: "expired",
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export function normalizeOxaPayStatus(status: string): PaymentStatus {
  const normalized = status.trim().toLowerCase();
  const known = Object.values(PAYMENT_STATUS) as string[];
  if (known.includes(normalized)) {
    return normalized as PaymentStatus;
  }
  return PAYMENT_STATUS.NEW;
}
