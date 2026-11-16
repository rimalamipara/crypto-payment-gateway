import { ApiProperty } from "@nestjs/swagger";

export class AuthUserDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, example: "alice@example.com" })
  email!: string;

  @ApiProperty({ type: String, example: "alice", nullable: true })
  username!: string | null;

  @ApiProperty({ type: String, example: "Alice", nullable: true })
  name!: string | null;

  @ApiProperty({ type: [String], example: ["user"] })
  roles!: string[];
}

export class AuthTokensResponseDto {
  @ApiProperty({
    type: String,
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  })
  accessToken!: string;

  @ApiProperty({ type: String, example: "Bearer", enum: ["Bearer"] })
  tokenType!: "Bearer";

  @ApiProperty({ type: String, example: "1d" })
  expiresIn!: string;

  @ApiProperty({ type: () => AuthUserDto })
  user!: AuthUserDto;
}
