import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreatePaymentDto {
  @ApiProperty({
    type: Number,
    example: 25.5,
    description: "USD top-up amount (platform is USD-only)",
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ type: String, example: "Wallet top-up" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: String, example: "https://yoursite.com/thanks" })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @ApiPropertyOptional({ type: String, example: "buyer@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    type: Number,
    example: 60,
    description: "Invoice lifetime in minutes (15–2880)",
  })
  @IsOptional()
  @IsNumber()
  @Min(15)
  @Max(2880)
  lifetime?: number;
}
