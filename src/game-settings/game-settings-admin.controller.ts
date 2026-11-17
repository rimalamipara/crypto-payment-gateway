import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import { PokerService } from "../poker/poker.service.ts";
import { RummyService } from "../rummy/rummy.service.ts";
import { TeenPattiService } from "../teen-patti/teen-patti.service.ts";
import { isGameKey, type GameKey } from "./game-settings.constants.ts";
import { GameSettingsService } from "./game-settings.service.ts";

class SetGameEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags("admin-games")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/games")
export class GameSettingsAdminController {
  constructor(
    @Inject(GameSettingsService) private readonly settings: GameSettingsService,
    @Inject(PokerService) private readonly poker: PokerService,
    @Inject(TeenPattiService) private readonly teenPatti: TeenPattiService,
    @Inject(RummyService) private readonly rummy: RummyService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List games with their enabled state" })
  @ApiForbiddenResponse({ description: "Requires admin" })
  list() {
    return this.settings.list();
  }

  @Put(":game")
  @ApiOperation({
    summary:
      "Enable or disable a game. Disabled: no new sit-downs, bets or hands. Hands in progress finish and players can still cash out.",
  })
  async set(@Param("game") game: string, @Body() dto: SetGameEnabledDto) {
    if (!isGameKey(game)) throw new BadRequestException("Unknown game");
    const result = await this.settings.setEnabled(game, dto.enabled);
    if (dto.enabled) await this.restartIdleTables(game);
    return result;
  }

  /**
   * While a game was off, hands that ended did not auto-start another. Kick every
   * table so players who stayed seated resume right away.
   */
  private async restartIdleTables(game: GameKey): Promise<void> {
    try {
      if (game === "poker") {
        for (const t of await this.poker.listTablesForUser()) {
          await this.poker.maybeStartHand(t.id);
        }
      } else if (game === "teen-patti") {
        for (const t of await this.teenPatti.listTablesForUser()) {
          await this.teenPatti.maybeStartHand(t.id);
        }
      } else if (game === "rummy") {
        for (const t of await this.rummy.listTablesForUser()) {
          await this.rummy.maybeStartHand(t.id);
        }
      }
    } catch {
      // Best effort: the next buy-in or hand end starts them anyway.
    }
  }
}
