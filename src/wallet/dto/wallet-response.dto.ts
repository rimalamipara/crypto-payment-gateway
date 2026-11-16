import { ApiProperty } from "@nestjs/swagger";

export class WalletResponseDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: Number, example: 1 })
  userId!: number;

  @ApiProperty({ type: String, example: "125.50000000" })
  balanceUsd!: string;

  @ApiProperty({
    type: String,
    example: "50.00000000",
    description: "Locked vault balance (not usable for bets)",
  })
  vaultUsd!: string;

  @ApiProperty({ type: String, example: "USD" })
  currency!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}

export class WalletStatsDto {
  @ApiProperty({
    type: String,
    example: "250.00000000",
    description: "Lifetime amount wagered across games",
  })
  totalWageredUsd!: string;

  @ApiProperty({
    type: String,
    example: "-12.50000000",
    description: "Net profit/loss from games (positive = profit)",
  })
  profitLossUsd!: string;

  @ApiProperty({ type: String, example: "125.50000000" })
  balanceUsd!: string;

  @ApiProperty({ type: String, example: "50.00000000" })
  vaultUsd!: string;
}

export class WalletTransactionDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, example: "credit_topup" })
  type!: string;

  @ApiProperty({ type: String, example: "25.00000000" })
  amountUsd!: string;

  @ApiProperty({ type: String, example: "125.50000000" })
  balanceAfter!: string;

  @ApiProperty({ type: String, nullable: true, example: "payment" })
  referenceType!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  referenceId!: number | null;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;
}
