import { Module } from "@nestjs/common";

import { WalletModule } from "../wallet/wallet.module.ts";
import { PaymentsController } from "./payments.controller.ts";
import { PaymentsRepository } from "./payments.repository.ts";
import { PaymentsService } from "./payments.service.ts";

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
