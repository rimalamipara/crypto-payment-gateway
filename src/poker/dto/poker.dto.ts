import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class BuyInDto {
  @ApiPropertyOptional({
    example: 50,
    description: "Optional. Omit to sit with full wallet balance.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountUsd?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  seatIndex?: number;
}

/** Sit at any open table for these blinds; creates a new table if all are full. */
export class JoinStakeDto {
  @ApiProperty({ example: 0.5 })
  @IsNumber()
  @Min(0.01)
  smallBlind!: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.01)
  bigBlind!: number;

  @ApiPropertyOptional({
    example: 50,
    description: "Optional. Omit to sit with full wallet balance.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountUsd?: number;
}

export class PokerActionDto {
  @ApiProperty({
    enum: ["fold", "check", "call", "bet", "raise", "all_in"],
  })
  @IsIn(["fold", "check", "call", "bet", "raise", "all_in"])
  action!: "fold" | "check" | "call" | "bet" | "raise" | "all_in";

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class CreatePokerTableDto {
  @ApiProperty({ example: "NLHE 0.50/1" })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  @Min(0.01)
  smallBlind!: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.02)
  bigBlind!: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(1)
  minBuyIn!: number;

  @ApiProperty({ example: 200 })
  @IsNumber()
  @Min(1)
  maxBuyIn!: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(9)
  maxSeats?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rakePercent?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rakeCap?: number;
}

export class UpdatePokerTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  smallBlind?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.02)
  bigBlind?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  minBuyIn?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxBuyIn?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(9)
  maxSeats?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rakePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  rakeCap?: number;

  @ApiPropertyOptional({ enum: ["open", "frozen", "disabled"] })
  @IsOptional()
  @IsIn(["open", "frozen", "disabled"])
  status?: "open" | "frozen" | "disabled";
}
