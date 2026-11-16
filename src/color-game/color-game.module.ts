import { Module } from "@nestjs/common";

import { WalletModule } from "../wallet/wallet.module.ts";
import { ColorGameAdminController } from "./color-game-admin.controller.ts";
import { ColorGameController } from "./color-game.controller.ts";
import { ColorGameRepository } from "./color-game.repository.ts";
import { ColorGameService } from "./color-game.service.ts";

@Module({
  imports: [WalletModule],
  controllers: [ColorGameController, ColorGameAdminController],
  providers: [ColorGameRepository, ColorGameService],
  exports: [ColorGameService],
})
export class ColorGameModule {}
