import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PayoutAssetDto {
  @ApiProperty({ type: String, example: "USDT" })
  currency!: string;

  @ApiProperty({ type: String, example: "Tether" })
  name!: string;

  @ApiProperty({ type: String, example: "TRC20" })
  network!: string;

  @ApiProperty({ type: String, example: "Tron Network" })
  networkName!: string;

  @ApiProperty({ type: String, example: "USDT / TRC20 (Tron Network)" })
  label!: string;

  @ApiPropertyOptional({ type: Number, example: 1 })
  withdrawFee?: number;

  @ApiPropertyOptional({ type: Number, example: 0.01 })
  withdrawMin?: number;
}
