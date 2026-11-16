import { ApiProperty } from "@nestjs/swagger";

import { ApiRequestLogDto } from "./api-request-log.dto.ts";
import { WebhookLogDto } from "./webhook-log.dto.ts";

export class PaginatedApiRequestLogsDto {
  @ApiProperty({ type: () => ApiRequestLogDto, isArray: true })
  items!: ApiRequestLogDto[];

  @ApiProperty({ type: Number, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, example: 50 })
  limit!: number;

  @ApiProperty({ type: Number, example: 120 })
  total!: number;

  @ApiProperty({ type: Number, example: 3 })
  totalPages!: number;
}

export class PaginatedWebhookLogsDto {
  @ApiProperty({ type: () => WebhookLogDto, isArray: true })
  items!: WebhookLogDto[];

  @ApiProperty({ type: Number, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, example: 50 })
  limit!: number;

  @ApiProperty({ type: Number, example: 40 })
  total!: number;

  @ApiProperty({ type: Number, example: 1 })
  totalPages!: number;
}
