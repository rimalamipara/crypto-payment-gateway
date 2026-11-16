import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.ts";
import { WalletModule } from "../wallet/wallet.module.ts";
import { PokerAdminController } from "./poker-admin.controller.ts";
import { PokerController } from "./poker.controller.ts";
import { PokerGateway } from "./poker.gateway.ts";
import { PokerRepository } from "./poker.repository.ts";
import { PokerService } from "./poker.service.ts";

@Module({
  imports: [WalletModule, AuthModule],
  controllers: [PokerController, PokerAdminController],
  providers: [PokerRepository, PokerService, PokerGateway],
  exports: [PokerService],
})
export class PokerModule {}
