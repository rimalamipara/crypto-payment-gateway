import { Controller, Get, Inject, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import {
  PaginatedApiRequestLogsDto,
  PaginatedWebhookLogsDto,
} from "./dto/paginated-logs.dto.ts";
import { IntegrationLogsService } from "./integration-logs.service.ts";

@ApiTags("admin")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/integration-logs")
export class IntegrationLogsController {
  constructor(
    @Inject(IntegrationLogsService)
    private readonly integrationLogsService: IntegrationLogsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List stored API request logs (admin, paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 50 })
  @ApiOkResponse({ type: () => PaginatedApiRequestLogsDto })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  listApis(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.integrationLogsService.listApiRequests(
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  @Get("webhooks")
  @ApiOperation({ summary: "List stored webhook payloads (admin, paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 50 })
  @ApiOkResponse({ type: () => PaginatedWebhookLogsDto })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  listWebhooks(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.integrationLogsService.listWebhooks(
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  private parsePage(page?: string): number {
    const parsed = page !== undefined ? Number(page) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  }

  private parseLimit(limit?: string): number {
    const parsed = limit !== undefined ? Number(limit) : 50;
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), 100)
      : 50;
  }
}
