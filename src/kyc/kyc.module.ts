import { Module } from "@nestjs/common";

import { KycController } from "./kyc.controller.ts";
import { KycService } from "./kyc.service.ts";

@Module({
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
