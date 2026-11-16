import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PayoutResponseDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: Number, example: 1 })
  userId!: number;

  @ApiProperty({ type: String, example: "20.00000000" })
  amountUsd!: string;

  @ApiProperty({ type: String, example: "USDT" })
  currency!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: "TRC20" })
  network!: string | null;

  @ApiProperty({ type: String, example: "TXYZabc..." })
  address!: string;

  @ApiProperty({ type: String, example: "processing" })
  status!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  trackId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  txHash!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fee!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  memo!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  updatedAt!: string;
}
