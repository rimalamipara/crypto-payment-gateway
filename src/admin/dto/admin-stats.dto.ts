import { ApiProperty } from "@nestjs/swagger";

export class PaymentStatsDto {
  @ApiProperty({ type: Number, example: 42 })
  totalCount!: number;

  @ApiProperty({ type: String, example: "1250.00000000" })
  totalAmountUsd!: string;

  @ApiProperty({ type: Number, example: 30 })
  paidCount!: number;

  @ApiProperty({ type: String, example: "980.00000000" })
  paidAmountUsd!: string;

  @ApiProperty({ type: Number, example: 8 })
  pendingCount!: number;

  @ApiProperty({ type: String, example: "200.00000000" })
  pendingAmountUsd!: string;

  @ApiProperty({ type: Number, example: 4 })
  expiredCount!: number;
}

export class PayoutStatsDto {
  @ApiProperty({ type: Number, example: 15 })
  totalCount!: number;

  @ApiProperty({ type: String, example: "400.00000000" })
  totalAmountUsd!: string;

  @ApiProperty({ type: Number, example: 10 })
  confirmedCount!: number;

  @ApiProperty({ type: String, example: "300.00000000" })
  confirmedAmountUsd!: string;

  @ApiProperty({ type: Number, example: 3 })
  processingCount!: number;

  @ApiProperty({ type: String, example: "70.00000000" })
  processingAmountUsd!: string;

  @ApiProperty({ type: Number, example: 2 })
  failedCount!: number;

  @ApiProperty({ type: String, example: "30.00000000" })
  failedAmountUsd!: string;
}

export class WalletStatsDto {
  @ApiProperty({
    type: Number,
    example: 20,
    description: "Number of user wallets",
  })
  walletCount!: number;

  @ApiProperty({
    type: String,
    example: "680.00000000",
    description: "Sum of all user USD wallet balances (platform liability)",
  })
  totalBalanceUsd!: string;
}

export class AdminStatsDto {
  @ApiProperty({ type: () => PaymentStatsDto })
  payments!: PaymentStatsDto;

  @ApiProperty({ type: () => PayoutStatsDto })
  payouts!: PayoutStatsDto;

  @ApiProperty({ type: () => WalletStatsDto })
  wallets!: WalletStatsDto;

  @ApiProperty({
    type: String,
    example: "680.00000000",
    description: "Paid top-ups minus confirmed payouts (USD)",
  })
  netVolumeUsd!: string;

  @ApiProperty({ type: Number, example: 25 })
  userCount!: number;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: String })
  generatedAt!: string;
}
