import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { RummyBuyInDto } from "./dto/rummy.dto.ts";
import { RummyService } from "./rummy.service.ts";

@ApiTags("rummy")
@ApiBearerAuth("access-token")
@Controller("rummy")
export class RummyController {
  constructor(@Inject(RummyService) private readonly rummy: RummyService) {}

  @Get("tables")
  @ApiOperation({ summary: "List open rummy tables" })
  @ApiOkResponse({ description: "Tables with seat counts" })
  listTables() {
    return this.rummy.listTablesForUser();
  }

  @Get("tables/:id")
  @ApiOperation({ summary: "Table detail + public seats" })
  getTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.rummy.getTableDetail(id, user.id);
  }

  @Post("tables/:id/buy-in")
  @ApiOperation({ summary: "Buy in and take a seat" })
  buyIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RummyBuyInDto,
  ) {
    return this.rummy.buyIn(user.id, id, dto);
  }

  @Post("tables/:id/cash-out")
  @ApiOperation({ summary: "Cash out remaining stack to wallet" })
  cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Query("force") force?: string,
  ) {
    return this.rummy.cashOut(user.id, id, force === "1" || force === "true");
  }
}
