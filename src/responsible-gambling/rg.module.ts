import { Global, Module } from "@nestjs/common";

import { ResponsibleGamblingController } from "./rg.controller.ts";
import { ResponsibleGamblingService } from "./rg.service.ts";

/** Global so game and payment services can call the assert* guards without module wiring. */
@Global()
@Module({
  controllers: [ResponsibleGamblingController],
  providers: [ResponsibleGamblingService],
  exports: [ResponsibleGamblingService],
})
export class ResponsibleGamblingModule {}
