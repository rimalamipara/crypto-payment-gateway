import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min } from "class-validator";

export class VaultAmountDto {
  @ApiProperty({ type: Number, example: 10, description: "USD amount" })
  @IsNumber()
  @Min(0.01)
  amountUsd!: number;
}
