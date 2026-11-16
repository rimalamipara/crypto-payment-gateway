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
  CreateRummyTableDto,
  UpdateRummyTableDto,
} from "./dto/rummy.dto.ts";
import { RummyService } from "./rummy.service.ts";

@ApiTags("admin-rummy")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/rummy")
export class RummyAdminController {
  constructor(@Inject(RummyService) private readonly rummy: RummyService) {}

  @Get("tables")
  @ApiOperation({ summary: "List all rummy tables (admin)" })
  @ApiForbiddenResponse({ description: "Requires admin" })
  listTables() {
    return this.rummy.adminListTables();
  }

  @Post("tables")
  @ApiOperation({ summary: "Create rummy table" })
  createTable(@Body() dto: CreateRummyTableDto) {
    return this.rummy.adminCreateTable(dto);
  }

  @Patch("tables/:id")
  @ApiOperation({ summary: "Update table config" })
  updateTable(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateRummyTableDto,
  ) {
    return this.rummy.adminUpdateTable(id, dto);
  }

  @Post("tables/:id/freeze")
  @ApiOperation({ summary: "Freeze table" })
  freeze(@Param("id", ParseIntPipe) id: number) {
    return this.rummy.freezeTable(id);
  }

  @Post("tables/:id/unfreeze")
  @ApiOperation({ summary: "Unfreeze table" })
  unfreeze(@Param("id", ParseIntPipe) id: number) {
    return this.rummy.unfreezeTable(id);
  }

  @Post("tables/:id/force-end")
  @ApiOperation({ summary: "Force-end active hand (refunds in-hand stacks)" })
  forceEnd(@Param("id", ParseIntPipe) id: number) {
    return this.rummy.forceEndHand(id);
  }

  @Get("hands")
  @ApiOperation({ summary: "Hand history" })
  @ApiOkResponse({ description: "Hands list" })
  listHands(
    @Query("tableId") tableId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.rummy.adminListHands(
      tableId ? Number(tableId) : undefined,
      limit ? Number(limit) : 50,
    );
  }

  @Get("stats/overview")
  @ApiOperation({ summary: "Rummy overview metrics" })
  overview() {
    return this.rummy.adminOverview();
  }
}
