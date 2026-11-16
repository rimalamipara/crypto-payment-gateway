import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { ApiRequestLoggingInterceptor } from "./api-request-logging.interceptor.ts";
import { IntegrationLogsController } from "./integration-logs.controller.ts";
import { IntegrationLogsRepository } from "./integration-logs.repository.ts";
import { IntegrationLogsService } from "./integration-logs.service.ts";

@Global()
@Module({
  controllers: [IntegrationLogsController],
  providers: [
    IntegrationLogsService,
    IntegrationLogsRepository,
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiRequestLoggingInterceptor,
    },
  ],
  exports: [IntegrationLogsService],
})
export class IntegrationLogsModule {}
