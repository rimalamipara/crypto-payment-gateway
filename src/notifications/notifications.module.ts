import { Global, Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller.ts";
import { NotificationsService } from "./notifications.service.ts";

/** Global so wallet/payments/games can call notify() without module wiring. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
