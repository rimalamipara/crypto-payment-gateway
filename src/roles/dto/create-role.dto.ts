import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateRoleDto {
  @ApiProperty({
    type: String,
    example: "merchant",
    description: "Lowercase role slug (letters, numbers, _ or -)",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message: "name must be lowercase alphanumeric with underscores/hyphens",
  })
  name!: string;

  @ApiPropertyOptional({ type: String, example: "Payment merchant" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
