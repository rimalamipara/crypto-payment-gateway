import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { DashboardService } from "./dashboard.service.ts";

@ApiTags("dashboard")
@ApiBearerAuth("access-token")
@Controller("dashboard")
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: "My dashboard: balance, stats, recent bets + transactions, unread notifications, KYC/2FA/limits status",
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.get(user.id);
  }
}
