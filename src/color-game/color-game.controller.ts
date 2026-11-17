import {
  Body,
  Controller,
  Get,
  Inject,
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
import { PlaceColorBetDto } from "./dto/color-game.dto.ts";
import { ColorGameService } from "./color-game.service.ts";
import {
  RequiresGame,
} from "../game-settings/requires-game.decorator.ts";

@ApiTags("color-game")
@ApiBearerAuth("access-token")
@RequiresGame("color")
@Controller("color-game")
export class ColorGameController {
  constructor(
    @Inject(ColorGameService) private readonly colorGame: ColorGameService,
  ) {}

  @Get("current")
  @ApiOperation({ summary: "Current color round + countdown" })
  @ApiOkResponse({ description: "Public round state" })
  current() {
    return this.colorGame.getCurrent();
  }

  @Post("bets")
  @ApiOperation({ summary: "Place a color/number bet" })
  placeBet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlaceColorBetDto,
  ) {
    return this.colorGame.placeBet(user.id, dto);
  }

  @Get("bets/mine")
  @ApiOperation({ summary: "My recent color bets (paginated)" })
  myBets(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.colorGame.myBets(
      user.id,
      page ? Math.max(1, Number(page) || 1) : 1,
      limit ? Math.min(100, Math.max(1, Number(limit) || 20)) : 20,
    );
  }

  @Get("rounds/recent")
  @ApiOperation({ summary: "Recent settled results (paginated)" })
  recent(
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.colorGame.recentRounds(
      limit ? Number(limit) : 10,
      page ? Number(page) : 1,
    );
  }
}
