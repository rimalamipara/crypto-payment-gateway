import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";

import { PHONE_REGEX } from "./register.dto.ts";

export class LoginDto {
  @ApiPropertyOptional({ type: String, example: "alice@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    type: String,
    example: "+919876543210",
    description: "E.164; use instead of email",
  })
  @IsOptional()
  @Matches(PHONE_REGEX)
  phone?: string;

  @ApiProperty({ type: String, example: "password123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
