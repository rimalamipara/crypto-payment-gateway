import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsPositive, IsString, MinLength } from "class-validator";

export class AssignRoleDto {
  @ApiProperty({ type: Number, example: 2 })
  @IsInt()
  @IsPositive()
  userId!: number;

  @ApiProperty({ type: String, example: "merchant" })
  @IsString()
  @MinLength(1)
  roleName!: string;
}
