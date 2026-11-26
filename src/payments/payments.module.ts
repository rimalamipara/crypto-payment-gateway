import { Module } from "@nestjs/common";

import { WalletModule } from "../wallet/wallet.module.ts";
import { PaymentGatewaysAdminController } from "./payment-gateways-admin.controller.ts";
import { PaymentGatewaysService } from "./payment-gateways.service.ts";
import { PaymentsController } from "./payments.controller.ts";
import { PaymentsRepository } from "./payments.repository.ts";
import { PaymentsService } from "./payments.service.ts";

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, PaymentGatewaysAdminController],
  providers: [PaymentsService, PaymentsRepository, PaymentGatewaysService],
  exports: [PaymentsService, PaymentGatewaysService],
})
export class PaymentsModule {}
