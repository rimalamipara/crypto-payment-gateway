import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class GoogleLoginDto {
  @ApiProperty({ type: String, description: "Google Sign-In ID token (JWT)" })
  @IsString()
  @MinLength(20)
  idToken!: string;
}
