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
import { BuyInDto, JoinStakeDto } from "./dto/poker.dto.ts";
import { PokerService } from "./poker.service.ts";
import { POKER_STAKE_TEMPLATES } from "./poker.stakes.ts";
import {
  AllowWhenDisabled,
  RequiresGame,
} from "../game-settings/requires-game.decorator.ts";

@ApiTags("poker")
@ApiBearerAuth("access-token")
@RequiresGame("poker")
@Controller("poker")
export class PokerController {
  constructor(@Inject(PokerService) private readonly poker: PokerService) {}

  @Get("stakes")
  @ApiOperation({ summary: "List NLHE stake templates" })
  listStakes() {
    return POKER_STAKE_TEMPLATES;
  }

  @Get("tables")
  @ApiOperation({ summary: "List open poker tables" })
  @ApiOkResponse({ description: "Tables with seat counts" })
  listTables() {
    return this.poker.listTablesForUser();
  }

  @Post("join")
  @ApiOperation({
    summary:
      "Sit at any open table for these blinds (auto-creates a table if all full)",
  })
  joinStake(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinStakeDto,
  ) {
    return this.poker.joinStake(user.id, dto);
  }

  @Get("tables/:id")
  @ApiOperation({ summary: "Table detail + public seats" })
  getTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.poker.getTableDetail(id, user.id);
  }

  @Post("tables/:id/buy-in")
  @ApiOperation({
    summary:
      "Buy in and take a seat (if full, seats you at a new same-stakes table)",
  })
  buyIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: BuyInDto,
  ) {
    return this.poker.buyIn(user.id, id, dto);
  }

  @AllowWhenDisabled()
  @Post("tables/:id/cash-out")
  @ApiOperation({ summary: "Cash out remaining stack to wallet" })
  cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Query("force") force?: string,
  ) {
    return this.poker.cashOut(user.id, id, force === "1" || force === "true");
  }

  @Get("hands/mine")
  @ApiOperation({ summary: "My hand history / P&L (paginated)" })
  myHands(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.poker.myHands(
      user.id,
      page ? Math.max(1, Number(page) || 1) : 1,
      limit ? Math.min(100, Math.max(1, Number(limit) || 20)) : 20,
    );
  }

  @Get("stats/me")
  @ApiOperation({ summary: "My poker stats" })
  myStats(@CurrentUser() user: AuthenticatedUser) {
    return this.poker.myStats(user.id);
  }
}
