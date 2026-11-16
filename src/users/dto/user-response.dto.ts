import { ApiProperty } from "@nestjs/swagger";

export class UserResponseDto {
  @ApiProperty({ type: String, example: "1" })
  id!: string;

  @ApiProperty({ type: String, example: "alice@example.com" })
  email!: string;

  @ApiProperty({ type: String, example: "alice", nullable: true })
  username!: string | null;

  @ApiProperty({ type: String, example: "Alice", nullable: true })
  name!: string | null;

  @ApiProperty({ type: [String], example: ["user", "admin"] })
  roles!: string[];

  @ApiProperty({ type: Boolean, example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, example: "2026-10-27 06:00:00+00" })
  createdAt!: string;
}
