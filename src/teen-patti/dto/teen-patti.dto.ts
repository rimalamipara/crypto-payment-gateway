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

export class TpBuyInDto {
  @ApiPropertyOptional({
    example: 100,
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

export class TpActionDto {
  @ApiProperty({ enum: ["pack", "blind", "chaal", "see", "show"] })
  @IsIn(["pack", "blind", "chaal", "see", "show"])
  action!: "pack" | "blind" | "chaal" | "see" | "show";
}

export class CreateTpTableDto {
  @ApiProperty({ example: "Teen Patti – Boot 2" })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.01)
  bootUsd!: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(1)
  minBuyIn!: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(1)
  maxBuyIn!: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(9)
  maxSeats?: number;
}

export class UpdateTpTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  bootUsd?: number;

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

  @ApiPropertyOptional({ enum: ["open", "frozen", "disabled"] })
  @IsOptional()
  @IsIn(["open", "frozen", "disabled"])
  status?: "open" | "frozen" | "disabled";
}
