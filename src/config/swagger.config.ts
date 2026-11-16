import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import {
  AuthTokensResponseDto,
  AuthUserDto,
} from "../auth/dto/auth-response.dto.ts";
import { APP_NAME } from "../common/constants/app.constants.ts";
import { AdminStatsDto } from "../admin/dto/admin-stats.dto.ts";
import { PaymentResponseDto } from "../payments/dto/payment-response.dto.ts";
import { PayoutResponseDto } from "../payouts/dto/payout-response.dto.ts";
import { RoleResponseDto } from "../roles/dto/role-response.dto.ts";
import { UserResponseDto } from "../users/dto/user-response.dto.ts";
import {
  WalletResponseDto,
  WalletTransactionDto,
} from "../wallet/dto/wallet-response.dto.ts";


export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("Crypto Payment Gateway")
    .setDescription(
      "USD wallet platform: OxaPay top-ups credit wallet balance; payouts withdraw via OxaPay (USDT by default).",
    )
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Paste the access token from `/auth/login` or `/auth/register`",
      },
      "access-token",
    )
    .addTag("app", "Health and metadata")
    .addTag("auth", "Register, login, and profile")
    .addTag("users", "User administration")
    .addTag("roles", "Dynamic role management")
    .addTag("admin", "Admin platform statistics")
    .addTag("wallet", "USD wallet balance and ledger")
    .addTag("payments", "OxaPay USD top-up invoices")
    .addTag("payouts", "OxaPay crypto withdrawals")
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      AuthTokensResponseDto,
      AuthUserDto,
      RoleResponseDto,
      UserResponseDto,
      PaymentResponseDto,
      WalletResponseDto,
      WalletTransactionDto,
      PayoutResponseDto,
      AdminStatsDto,
    ],

    operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
  });

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
    customSiteTitle: `${APP_NAME} docs`,
  });
}
