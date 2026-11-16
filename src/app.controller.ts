import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { APP_NAME } from "./common/constants/app.constants.ts";
import { Public } from "./common/decorators/public.decorator.ts";

@ApiTags("app")
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: "API metadata" })
  @ApiOkResponse({ description: "Service info and endpoint map" })
  getRoot() {
    return {
      name: APP_NAME,
      message: "Crypto payment gateway API",
      docs: {
        swagger: "GET /docs",
        register: "POST /auth/register",
        login: "POST /auth/login",
        me: "GET /auth/me",
        users: "GET /users, DELETE /users/:id, POST /users/:id/restore (admin)",
        roles: "GET|POST /roles (admin)",
        adminStats: "GET /admin/stats (admin)",
        createAdmin: "POST /admin/users (admin)",
        integrationLogs:
          "GET /admin/integration-logs, GET /admin/integration-logs/webhooks (admin)",
        wallet: "GET /wallet, GET /wallet/transactions",
        payments: "POST /payments (USD top-up), POST /payments/webhook",
        payouts: "POST /payouts, POST /payouts/webhook",
        health: "GET /health",
      },
    };
  }

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Health check" })
  @ApiOkResponse({ description: "Service is healthy" })
  getHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
