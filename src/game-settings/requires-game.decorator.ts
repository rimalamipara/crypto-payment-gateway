import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";

import {
  ALLOW_WHEN_DISABLED_KEY,
  GameEnabledGuard,
  REQUIRES_GAME_KEY,
} from "./game-enabled.guard.ts";
import type { GameKey } from "./game-settings.constants.ts";

/** Reject the request (403) while the admin has this game switched off. */
export const RequiresGame = (game: GameKey) =>
  applyDecorators(
    SetMetadata(REQUIRES_GAME_KEY, game),
    UseGuards(GameEnabledGuard),
  );

/** Keep this route working while the game is off (use on cash-out only). */
export const AllowWhenDisabled = () => SetMetadata(ALLOW_WHEN_DISABLED_KEY, true);
