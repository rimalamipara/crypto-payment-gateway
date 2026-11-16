export const WALLET_TX_TYPE = {
  CREDIT_TOPUP: "credit_topup",
  DEBIT_PAYOUT: "debit_payout",
  CREDIT_PAYOUT_REFUND: "credit_payout_refund",
  DEBIT_POKER_BUYIN: "debit_poker_buyin",
  CREDIT_POKER_CASHOUT: "credit_poker_cashout",
  DEBIT_POKER_HAND: "debit_poker_hand",
  CREDIT_POKER_HAND: "credit_poker_hand",
  DEBIT_COLOR_BET: "debit_color_bet",
  CREDIT_COLOR_WIN: "credit_color_win",
  CREDIT_COLOR_REFUND: "credit_color_refund",
  DEBIT_TEEN_BUYIN: "debit_teen_buyin",
  CREDIT_TEEN_CASHOUT: "credit_teen_cashout",
  DEBIT_TEEN_HAND: "debit_teen_hand",
  CREDIT_TEEN_HAND: "credit_teen_hand",
  DEBIT_RUMMY_BUYIN: "debit_rummy_buyin",
  CREDIT_RUMMY_CASHOUT: "credit_rummy_cashout",
  DEBIT_RUMMY_HAND: "debit_rummy_hand",
  CREDIT_RUMMY_HAND: "credit_rummy_hand",
  /** Move spendable wallet → vault (locks funds from play). */
  DEBIT_VAULT_DEPOSIT: "debit_vault_deposit",
  /** Move vault → spendable wallet. */
  CREDIT_VAULT_WITHDRAW: "credit_vault_withdraw",
  ADJUST: "adjust",
} as const;

export type WalletTxType = (typeof WALLET_TX_TYPE)[keyof typeof WALLET_TX_TYPE];
