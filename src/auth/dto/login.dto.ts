import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ type: String, example: "alice@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: "password123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
