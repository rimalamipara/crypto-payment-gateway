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
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import { CreateTpTableDto, UpdateTpTableDto } from "./dto/teen-patti.dto.ts";
import { TeenPattiService } from "./teen-patti.service.ts";

@ApiTags("admin-teen-patti")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/teen-patti")
export class TeenPattiAdminController {
  constructor(@Inject(TeenPattiService) private readonly tp: TeenPattiService) {}

  @Get("tables")
  @ApiOperation({ summary: "List all Teen Patti tables (admin)" })
  @ApiForbiddenResponse({ description: "Requires admin" })
  listTables() {
    return this.tp.adminListTables();
  }

  @Post("tables")
  @ApiOperation({ summary: "Create Teen Patti table" })
  createTable(@Body() dto: CreateTpTableDto) {
    return this.tp.adminCreateTable(dto);
  }

  @Patch("tables/:id")
  @ApiOperation({ summary: "Update table config" })
  updateTable(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTpTableDto,
  ) {
    return this.tp.adminUpdateTable(id, dto);
  }

  @Post("tables/:id/freeze")
  @ApiOperation({ summary: "Freeze table" })
  freeze(@Param("id", ParseIntPipe) id: number) {
    return this.tp.freezeTable(id);
  }

  @Post("tables/:id/unfreeze")
  @ApiOperation({ summary: "Unfreeze table" })
  unfreeze(@Param("id", ParseIntPipe) id: number) {
    return this.tp.unfreezeTable(id);
  }

  @Post("tables/:id/force-end")
  @ApiOperation({ summary: "Force-end active hand; refund pot" })
  forceEnd(@Param("id", ParseIntPipe) id: number) {
    return this.tp.forceEndHand(id);
  }

  @Get("hands")
  @ApiOperation({ summary: "Hand history" })
  listHands(
    @Query("tableId") tableId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.tp.adminListHands(
      tableId ? Number(tableId) : undefined,
      limit ? Number(limit) : 50,
    );
  }

  @Get("stats/overview")
  @ApiOperation({ summary: "Teen Patti overview metrics" })
  overview() {
    return this.tp.adminOverview();
  }
}
