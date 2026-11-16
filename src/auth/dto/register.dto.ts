import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @ApiProperty({ type: String, example: "alice@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: "password123", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ type: String, example: "alice" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @ApiPropertyOptional({ type: String, example: "Alice" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
