import { Module } from "@nestjs/common";

import { KycModule } from "../kyc/kyc.module.ts";
import { WalletModule } from "../wallet/wallet.module.ts";
import { DashboardController } from "./dashboard.controller.ts";
import { DashboardService } from "./dashboard.service.ts";

@Module({
  imports: [WalletModule, KycModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
