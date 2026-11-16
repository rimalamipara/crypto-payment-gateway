import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreatePayoutDto {
  @ApiProperty({
    type: Number,
    example: 20,
    description: "USD amount to withdraw (debited from wallet, sent as crypto)",
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(1)
  amountUsd!: number;

  @ApiProperty({
    type: String,
    example: "TXYZabc...",
    description: "Destination crypto address",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  address!: string;

  @ApiProperty({
    type: String,
    example: "USDT",
    description: "Payout crypto currency chosen by the user",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  currency!: string;

  @ApiProperty({
    type: String,
    example: "TRC20",
    description: "Blockchain network chosen by the user (e.g. TRC20, ERC20, BEP20)",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  network!: string;

  @ApiPropertyOptional({ type: String, example: "User withdrawal" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  memo?: string;
}
