import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNumber, IsOptional, Max, Min, ValidateIf } from "class-validator";

export class SetLimitsDto {
  @ApiPropertyOptional({ type: Number, nullable: true, description: "USD per rolling 24h; null removes" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber() @Min(1) @Max(1_000_000)
  dailyDepositLimitUsd?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Net loss USD per rolling 24h; null removes" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber() @Min(1) @Max(1_000_000)
  dailyLossLimitUsd?: number | null;
}

export class CoolingOffDto {
  @ApiProperty({ enum: [1, 7, 30] }) @IsIn([1, 7, 30])
  days!: number;
}

export class SelfExcludeDto {
  @ApiProperty({ enum: [30, 90, 180, 365, 0], description: "0 = permanent. Cannot be undone." })
  @IsIn([30, 90, 180, 365, 0])
  days!: number;
}
