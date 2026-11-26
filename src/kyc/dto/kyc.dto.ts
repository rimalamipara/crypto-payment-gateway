import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength } from "class-validator";

const url = { protocols: ["https"], require_protocol: true };

export class SubmitKycDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(120)
  fullName!: string;

  @ApiProperty({ type: String, example: "1990-05-31" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;

  @ApiProperty({ type: String, example: "IN" }) @Matches(/^[A-Z]{2}$/)
  country!: string;

  @ApiProperty({ enum: ["passport", "national_id", "driving_license"] })
  @IsIn(["passport", "national_id", "driving_license"])
  docType!: string;

  @ApiProperty({ type: String }) @IsString() @MaxLength(64)
  docNumber!: string;

  @ApiProperty({ type: String }) @IsUrl(url) @MaxLength(500)
  docFrontUrl!: string;

  @ApiPropertyOptional({ type: String }) @IsOptional() @IsUrl(url) @MaxLength(500)
  docBackUrl?: string;

  @ApiProperty({ type: String }) @IsUrl(url) @MaxLength(500)
  selfieUrl!: string;
}

export class RejectKycDto {
  @ApiProperty({ type: String }) @IsString() @MaxLength(500)
  reason!: string;
}
