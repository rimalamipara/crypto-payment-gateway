export interface OxaPayInvoiceRequest {
  amount: number;
  currency?: string;
  lifetime?: number;
  fee_paid_by_payer?: number;
  under_paid_coverage?: number;
  to_currency?: string;
  auto_withdrawal?: boolean;
  mixed_payment?: boolean;
  callback_url?: string;
  return_url?: string;
  email?: string;
  order_id?: string;
  thanks_message?: string;
  description?: string;
  sandbox?: boolean;
}

export interface OxaPayInvoiceData {
  track_id: string;
  payment_url: string;
  expired_at: number;
  date: number;
}

export interface OxaPayApiResponse<T> {
  data: T;
  message?: string;
  error?: { type?: string; key?: string; message?: string } | null;
  status: number;
  version?: string;
}

export interface OxaPayPaymentTx {
  tx_hash?: string;
  amount?: number;
  sent_amount?: number;
  received_amount?: number;
  currency?: string;
  network?: string;
  address?: string;
  status?: string;
  confirmations?: number;
  date?: number;
}

export interface OxaPayPaymentInfo {
  track_id: string;
  type?: string;
  amount?: number;
  currency?: string;
  status: string;
  order_id?: string;
  email?: string;
  description?: string;
  expired_at?: number;
  date?: number;
  txs?: OxaPayPaymentTx[];
}

export interface OxaPayPayoutRequest {
  address: string;
  currency: string;
  amount: number;
  network?: string;
  callback_url?: string;
  memo?: string;
  description?: string;
}

export interface OxaPayPayoutData {
  track_id: string;
  status: string;
}

export interface OxaPayPayoutInfo {
  track_id: string;
  address?: string;
  currency?: string;
  network?: string;
  amount?: number;
  fee?: number;
  status: string;
  tx_hash?: string;
  description?: string;
  memo?: string;
  date?: number;
}

export interface OxaPayCurrencyNetwork {
  network: string;
  name: string;
  keys?: string[];
  required_confirmations?: number;
  withdraw_fee?: number;
  withdraw_min?: number;
  deposit_min?: number;
  static_fixed_fee?: number;
}

export interface OxaPayCurrencyInfo {
  symbol: string;
  name: string;
  status: boolean;
  networks: Record<string, OxaPayCurrencyNetwork>;
}

export type OxaPayCurrenciesMap = Record<string, OxaPayCurrencyInfo>;

export interface OxaPayWebhookPayload {
  track_id: string;
  status: string;
  type?: string;
  amount?: number;
  value?: number;
  currency?: string;
  order_id?: string;
  email?: string;
  description?: string;
  address?: string;
  network?: string;
  tx_hash?: string;
  date?: number;
  txs?: OxaPayPaymentTx[];
}
