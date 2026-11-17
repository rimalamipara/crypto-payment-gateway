import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { GAME_LABELS, type GameKey } from "./game-settings.constants.ts";
import { GameSettingsService } from "./game-settings.service.ts";

export const REQUIRES_GAME_KEY = "requiresGame";
/** Routes that stay open while the game is off (cash-out: players must get their money back). */
export const ALLOW_WHEN_DISABLED_KEY = "allowWhenDisabled";

@Injectable()
export class GameEnabledGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GameSettingsService) private readonly settings: GameSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const game = this.reflector.getAllAndOverride<GameKey | undefined>(
      REQUIRES_GAME_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!game) return true;
    if (this.reflector.get<boolean>(ALLOW_WHEN_DISABLED_KEY, context.getHandler())) {
      return true;
    }
    if (await this.settings.isEnabled(game)) return true;
    throw new ForbiddenException(
      `${GAME_LABELS[game]} is currently unavailable. Please try again later.`,
    );
  }
}
