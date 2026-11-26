import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

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

  @ApiPropertyOptional({ type: String, example: "+919876543210", description: "E.164" })
  @IsOptional()
  @Matches(PHONE_REGEX)
  phone?: string;
}
