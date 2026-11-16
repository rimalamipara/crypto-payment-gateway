import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.ts";
import { WalletModule } from "../wallet/wallet.module.ts";
import { TeenPattiAdminController } from "./teen-patti-admin.controller.ts";
import { TeenPattiController } from "./teen-patti.controller.ts";
import { TeenPattiGateway } from "./teen-patti.gateway.ts";
import { TeenPattiRepository } from "./teen-patti.repository.ts";
import { TeenPattiService } from "./teen-patti.service.ts";

@Module({
  imports: [WalletModule, AuthModule],
  controllers: [TeenPattiController, TeenPattiAdminController],
  providers: [TeenPattiRepository, TeenPattiService, TeenPattiGateway],
  exports: [TeenPattiService],
})
export class TeenPattiModule {}
