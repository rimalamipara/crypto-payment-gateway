import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiRequestLogDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String, example: "inbound" })
  direction!: string;

  @ApiProperty({ type: String, example: "gateway" })
  source!: string;

  @ApiProperty({ type: String, example: "POST" })
  method!: string;

  @ApiProperty({ type: String, example: "/payments" })
  path!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  url!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  requestHeaders!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  requestBody!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  responseStatus!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  responseBody!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  ip!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  userId!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  trackId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  orderId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  durationMs!: number | null;

  @ApiProperty({ type: Boolean })
  success!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;
}
