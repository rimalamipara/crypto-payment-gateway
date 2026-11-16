import { Module } from "@nestjs/common";

import { WalletModule } from "../wallet/wallet.module.ts";
import { PayoutsController } from "./payouts.controller.ts";
import { PayoutsRepository } from "./payouts.repository.ts";
import { PayoutsService } from "./payouts.service.ts";

@Module({
  imports: [WalletModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
  exports: [PayoutsService],
})
export class PayoutsModule {}
