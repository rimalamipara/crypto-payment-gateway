import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdminModule } from "./admin/admin.module.ts";
import { AppController } from "./app.controller.ts";
import { CacheModule } from "./cache/cache.module.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { ColorGameModule } from "./color-game/color-game.module.ts";
import { configuration } from "./config/index.ts";
import {
  GameSettingsAdminModule,
  GameSettingsModule,
} from "./game-settings/game-settings.module.ts";
import { IntegrationLogsModule } from "./integration-logs/integration-logs.module.ts";
import { LobbyModule } from "./lobby/lobby.module.ts";
import { OxaPayModule } from "./oxapay/oxapay.module.ts";
import { PaymentsModule } from "./payments/payments.module.ts";
import { PayoutsModule } from "./payouts/payouts.module.ts";
import { PokerModule } from "./poker/poker.module.ts";
import { TeenPattiModule } from "./teen-patti/teen-patti.module.ts";
import { RummyModule } from "./rummy/rummy.module.ts";
import { SecureTransportModule } from "./secure-transport/secure-transport.module.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";
import { RolesModule } from "./roles/roles.module.ts";
import { UsersModule } from "./users/users.module.ts";
import { WalletModule } from "./wallet/wallet.module.ts";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
      load: [configuration],
    }),
    PrismaModule,
    CacheModule,
    IntegrationLogsModule,
    OxaPayModule,
    AuthModule,
    RolesModule,
    UsersModule,
    WalletModule,
    PaymentsModule,
    PayoutsModule,
    PokerModule,
    TeenPattiModule,
    RummyModule,
    ColorGameModule,
    SecureTransportModule,
    GameSettingsModule,
    GameSettingsAdminModule,
    LobbyModule,
    AdminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

