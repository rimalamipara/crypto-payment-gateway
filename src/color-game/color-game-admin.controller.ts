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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import { ColorNumberDto } from "./dto/color-game.dto.ts";
import { ColorGameService } from "./color-game.service.ts";

@ApiTags("admin-color-game")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/color-game")
export class ColorGameAdminController {
  constructor(
    @Inject(ColorGameService) private readonly colorGame: ColorGameService,
  ) {}

  @Get("current")
  @ApiOperation({ summary: "Live round + bet tallies (admin)" })
  @ApiForbiddenResponse({ description: "Requires admin" })
  current() {
    return this.colorGame.getCurrentAdmin();
  }

  @Get("rounds")
  @ApiOperation({ summary: "Paginated round history" })
  @ApiOkResponse({ description: "Rounds page" })
  rounds(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.colorGame.adminListRounds(
      page ? Math.max(1, Number(page)) : 1,
      limit ? Math.min(100, Math.max(1, Number(limit))) : 50,
    );
  }

  @Post("preset")
  @ApiOperation({
    summary: "Queue winning number for current (or next) round",
  })
  preset(@Body() dto: ColorNumberDto) {
    return this.colorGame.adminPreset(dto.number);
  }

  @Post("reveal")
  @ApiOperation({
    summary: "Reveal & settle after reveal time with given number",
  })
  reveal(@Body() dto: ColorNumberDto) {
    return this.colorGame.adminReveal(dto.number);
  }

  @Post("force-reveal")
  @ApiOperation({
    summary: "Alias of reveal (after reveal time only)",
    deprecated: true,
  })
  forceReveal(@Body() dto: ColorNumberDto) {
    return this.colorGame.adminReveal(dto.number);
  }

  @Post("cancel")
  @ApiOperation({
    summary: "Cancel draw after reveal time — refund bets, skip result",
  })
  cancel() {
    return this.colorGame.adminCancelDraw();
  }

  @Get("stats/overview")
  @ApiOperation({ summary: "Color game volume / payouts overview" })
  overview() {
    return this.colorGame.adminOverview();
  }
}
