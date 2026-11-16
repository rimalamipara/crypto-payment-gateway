import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.ts";
import { WalletModule } from "../wallet/wallet.module.ts";
import { RummyAdminController } from "./rummy-admin.controller.ts";
import { RummyController } from "./rummy.controller.ts";
import { RummyGateway } from "./rummy.gateway.ts";
import { RummyRepository } from "./rummy.repository.ts";
import { RummyService } from "./rummy.service.ts";

@Module({
  imports: [WalletModule, AuthModule],
  controllers: [RummyController, RummyAdminController],
  providers: [RummyRepository, RummyService, RummyGateway],
  exports: [RummyService],
})
export class RummyModule {}
