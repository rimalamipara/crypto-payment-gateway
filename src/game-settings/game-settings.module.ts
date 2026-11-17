import { Global, Module } from "@nestjs/common";

import { PokerModule } from "../poker/poker.module.ts";
import { RummyModule } from "../rummy/rummy.module.ts";
import { TeenPattiModule } from "../teen-patti/teen-patti.module.ts";
import { GameEnabledGuard } from "./game-enabled.guard.ts";
import { GameSettingsAdminController } from "./game-settings-admin.controller.ts";
import { GameSettingsRepository } from "./game-settings.repository.ts";
import { GameSettingsService } from "./game-settings.service.ts";

/**
 * Global, with no dependency on the game modules: they inject
 * GameSettingsService / use @RequiresGame(), so importing them here would be a
 * module cycle. The admin controller (which needs the game services) lives in
 * GameSettingsAdminModule below.
 */
@Global()
@Module({
  providers: [GameSettingsRepository, GameSettingsService, GameEnabledGuard],
  exports: [GameSettingsService, GameEnabledGuard],
})
export class GameSettingsModule {}

@Module({
  imports: [PokerModule, TeenPattiModule, RummyModule],
  controllers: [GameSettingsAdminController],
})
export class GameSettingsAdminModule {}
