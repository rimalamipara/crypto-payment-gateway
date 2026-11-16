import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class RummyBuyInDto {
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
  @Max(5)
  seatIndex?: number;
}

export class RummyActionDto {
  @ApiProperty({
    enum: ["draw_closed", "draw_open", "discard", "declare", "drop"],
  })
  @IsIn(["draw_closed", "draw_open", "discard", "declare", "drop"])
  type!: "draw_closed" | "draw_open" | "discard" | "declare" | "drop";

  /** Card code for discard action, e.g. "Ah", "Td" */
  @ApiPropertyOptional({ example: "Ah" })
  @IsOptional()
  @IsString()
  card?: string;

  /** For declare: array of meld groups */
  @ApiPropertyOptional({
    example: [["Ah", "2h", "3h"], ["Ks", "Kd", "Kc"], ["5c", "6c", "7c", "8c"]],
  })
  @IsOptional()
  @IsArray()
  melds?: string[][];
}

export class CreateRummyTableDto {
  @ApiProperty({ example: "Rummy 1pt" })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.01)
  pointValue!: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(1)
  minBuyIn!: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(1)
  maxBuyIn!: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  maxSeats?: number;
}

export class UpdateRummyTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  pointValue?: number;

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
  @Max(6)
  maxSeats?: number;

  @ApiPropertyOptional({ enum: ["open", "frozen", "disabled"] })
  @IsOptional()
  @IsIn(["open", "frozen", "disabled"])
  status?: "open" | "frozen" | "disabled";
}
