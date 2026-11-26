import { Module } from "@nestjs/common";

import { KycModule } from "../kyc/kyc.module.ts";
import { PaymentsModule } from "../payments/payments.module.ts";
import { WalletModule } from "../wallet/wallet.module.ts";
import { PayoutsController } from "./payouts.controller.ts";
import { PayoutsRepository } from "./payouts.repository.ts";
import { PayoutsService } from "./payouts.service.ts";

@Module({
  imports: [WalletModule, PaymentsModule, KycModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
  exports: [PayoutsService],
})
export class PayoutsModule {}
