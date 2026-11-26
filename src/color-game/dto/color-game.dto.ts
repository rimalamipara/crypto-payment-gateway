import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

import { ROUND_DURATIONS_SEC } from "../color-game.rules.ts";

const durationApi = {
  enum: [...ROUND_DURATIONS_SEC],
  description: "Session length in seconds (default 180)",
};

export class PlaceColorBetDto {
  @ApiProperty({ enum: ["color", "number"] })
  @IsIn(["color", "number"])
  betType!: "color" | "number";

  @ApiProperty({ example: "red", description: "red|green|violet or 0-9" })
  @IsString()
  selection!: string;

  @ApiProperty({
    example: 1,
    description: "USD stake; string or number (full balance OK)",
  })
  @Transform(({ value }) => {
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.01)
  amountUsd!: number;

  @ApiPropertyOptional(durationApi)
  @IsOptional()
  @IsIn([...ROUND_DURATIONS_SEC])
  durationSec?: number;
}

export class ColorNumberDto {
  @ApiProperty({ example: 5, minimum: 0, maximum: 9 })
  @IsInt()
  @Min(0)
  @Max(9)
  number!: number;

  @ApiPropertyOptional(durationApi)
  @IsOptional()
  @IsIn([...ROUND_DURATIONS_SEC])
  durationSec?: number;
}

export class ColorRoundPublicDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  periodNo!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty(durationApi)
  durationSec!: number;

  @ApiPropertyOptional({ nullable: true })
  resultNumber!: number | null;

  @ApiPropertyOptional({ nullable: true })
  resultColors!: string | null;

  @ApiProperty()
  startsAt!: string;

  @ApiProperty()
  betsCloseAt!: string;

  @ApiProperty()
  revealsAt!: string;

  @ApiPropertyOptional({ nullable: true })
  settledAt!: string | null;

  @ApiProperty()
  serverNow!: string;

  @ApiProperty()
  msToClose!: number;

  @ApiProperty()
  msToReveal!: number;
}
