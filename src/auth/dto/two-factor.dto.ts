import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

const CODE = /^\d{6}$/;

export class TwoFactorCodeDto {
  @ApiProperty({ type: String, example: "123456" })
  @Matches(CODE)
  code!: string;
}

export class TwoFactorLoginDto extends TwoFactorCodeDto {
  @ApiProperty({ type: String, description: "twoFactorToken returned by /auth/login" })
  @IsString()
  @MinLength(20)
  twoFactorToken!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @ApiProperty({ type: String })
  @IsString()
  password!: string;
}
