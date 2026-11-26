import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import { PHONE_REGEX } from "../../auth/dto/register.dto.ts";

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @MaxLength(64)
  username?: string;

  @ApiPropertyOptional({ type: String, example: "+919876543210" })
  @IsOptional() @Matches(PHONE_REGEX)
  phone?: string;

  @ApiPropertyOptional({ type: String, example: "IN", description: "ISO 3166 alpha-2" })
  @IsOptional() @Matches(/^[A-Z]{2}$/)
  country?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional() @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(500)
  avatarUrl?: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({ type: String }) @IsString()
  currentPassword!: string;

  @ApiPropertyOptional({ type: String, minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128)
  newPassword!: string;
}
