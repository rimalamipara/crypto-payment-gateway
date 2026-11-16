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
import { TpBuyInDto } from "./dto/teen-patti.dto.ts";
import { TeenPattiService } from "./teen-patti.service.ts";

@ApiTags("teen-patti")
@ApiBearerAuth("access-token")
@Controller("teen-patti")
export class TeenPattiController {
  constructor(@Inject(TeenPattiService) private readonly tp: TeenPattiService) {}

  @Get("tables")
  @ApiOperation({ summary: "List open Teen Patti tables" })
  @ApiOkResponse({ description: "Tables with seat counts" })
  listTables() {
    return this.tp.listTablesForUser();
  }

  @Get("tables/:id")
  @ApiOperation({ summary: "Table detail + public seats" })
  getTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.tp.getTableDetail(id, user.id);
  }

  @Post("tables/:id/buy-in")
  @ApiOperation({ summary: "Buy in and take a seat" })
  buyIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: TpBuyInDto,
  ) {
    return this.tp.buyIn(user.id, id, dto);
  }

  @Post("tables/:id/cash-out")
  @ApiOperation({ summary: "Cash out remaining stack to wallet" })
  cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Query("force") force?: string,
  ) {
    return this.tp.cashOut(user.id, id, force === "1" || force === "true");
  }
}
