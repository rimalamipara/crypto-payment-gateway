import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class WebhookLogDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String, example: "oxapay" })
  source!: string;

  @ApiProperty({ type: String, example: "merchant" })
  channel!: string;

  @ApiProperty({ type: String, example: "POST" })
  method!: string;

  @ApiProperty({ type: String, example: "/payments/webhook" })
  path!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  requestHeaders!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  requestBody!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  responseStatus!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  responseBody!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  hmacHeader!: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  signatureValid!: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  trackId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  orderId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  relatedType!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  relatedId!: number | null;

  @ApiProperty({ type: Boolean })
  success!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ type: String })
  createdAt!: string;
}
