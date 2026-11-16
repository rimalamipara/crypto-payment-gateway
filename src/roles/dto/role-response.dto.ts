import { ApiProperty } from "@nestjs/swagger";

export class RoleResponseDto {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, example: "admin" })
  name!: string;

  @ApiProperty({ type: String, example: "Administrator with elevated access", nullable: true })
  description!: string | null;

  @ApiProperty({ type: Boolean, example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, example: "2026-10-27 06:00:00+00" })
  createdAt!: string;
}
