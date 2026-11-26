import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { parseLimit, parsePage } from "../common/pagination.ts";
import { NotificationsService } from "./notifications.service.ts";

@ApiTags("notifications")
@ApiBearerAuth("access-token")
@Controller("notifications")
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "My notifications (paginated, ?unread=true for unread only)" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("unread") unread?: string,
  ) {
    return this.svc.list(user.id, parsePage(page), parseLimit(limit, 20), unread === "true");
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.unreadCount(user.id);
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.markAllRead(user.id);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.svc.markRead(user.id, id);
  }
}
