import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import {
  CreatePokerTableDto,
  UpdatePokerTableDto,
} from "./dto/poker.dto.ts";
import { PokerService } from "./poker.service.ts";

@ApiTags("admin-poker")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/poker")
export class PokerAdminController {
  constructor(@Inject(PokerService) private readonly poker: PokerService) {}

  @Get("tables")
  @ApiOperation({ summary: "List all poker tables (admin)" })
  @ApiForbiddenResponse({ description: "Requires admin" })
  listTables() {
    return this.poker.adminListTables();
  }

  @Post("tables")
  @ApiOperation({ summary: "Create poker table" })
  createTable(@Body() dto: CreatePokerTableDto) {
    return this.poker.adminCreateTable(dto);
  }

  @Patch("tables/:id")
  @ApiOperation({ summary: "Update table config" })
  updateTable(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePokerTableDto,
  ) {
    return this.poker.adminUpdateTable(id, dto);
  }

  @Post("tables/:id/freeze")
  @ApiOperation({ summary: "Freeze table (no new actions/hands)" })
  freeze(@Param("id", ParseIntPipe) id: number) {
    return this.poker.freezeTable(id);
  }

  @Post("tables/:id/unfreeze")
  @ApiOperation({ summary: "Unfreeze table" })
  unfreeze(@Param("id", ParseIntPipe) id: number) {
    return this.poker.unfreezeTable(id);
  }

  @Post("tables/:id/force-end")
  @ApiOperation({
    summary: "Force-end active hand; refund pot proportionally",
  })
  forceEnd(@Param("id", ParseIntPipe) id: number) {
    return this.poker.forceEndHand(id);
  }

  @Get("hands")
  @ApiOperation({ summary: "Hand history (paginated)" })
  @ApiOkResponse({ description: "Paginated hands with winners" })
  listHands(
    @Query("tableId") tableId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.poker.adminListHands(
      tableId ? Number(tableId) : undefined,
      page ? Math.max(1, Number(page) || 1) : 1,
      limit ? Math.min(100, Math.max(1, Number(limit) || 50)) : 50,
    );
  }

  @Get("hands/:id")
  @ApiOperation({ summary: "Hand detail with actions + cards" })
  handDetail(@Param("id", ParseIntPipe) id: number) {
    return this.poker.adminHandDetail(id);
  }

  @Get("stats/players")
  @ApiOperation({ summary: "Per-player poker stats (paginated)" })
  playerStats(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.poker.adminPlayerStats(
      page ? Math.max(1, Number(page) || 1) : 1,
      limit ? Math.min(100, Math.max(1, Number(limit) || 50)) : 50,
    );
  }

  @Get("stats/overview")
  @ApiOperation({ summary: "Poker overview metrics" })
  overview() {
    return this.poker.adminOverview();
  }
}
