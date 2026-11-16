import { Module } from "@nestjs/common";

import { WalletController } from "./wallet.controller.ts";
import { WalletService } from "./wallet.service.ts";

@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
