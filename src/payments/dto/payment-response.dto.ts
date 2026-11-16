import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PaymentResponseDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, example: "ord_1_1730000000_ab12" })
  orderId!: string;

  @ApiProperty({ type: Number, example: 1 })
  userId!: number;

  @ApiProperty({ type: String, example: "25.50000000" })
  amount!: string;

  @ApiProperty({ type: String, example: "USD" })
  currency!: string;

  @ApiProperty({ type: String, example: "topup" })
  purpose!: string;

  @ApiProperty({ type: String, example: "new" })
  status!: string;

  @ApiProperty({ type: Boolean, example: false })
  walletCredited!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: "168931368" })
  trackId!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "https://pay.oxapay.com/...",
  })
  paymentUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  returnUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  paidCurrency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  paidAmount!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  txHash!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiresAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  paidAt!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}
