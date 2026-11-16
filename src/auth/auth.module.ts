import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";

import { JwtAuthGuard } from "../common/guards/jwt-auth.guard.ts";
import { RolesGuard } from "../common/guards/roles.guard.ts";
import { RolesModule } from "../roles/roles.module.ts";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthService } from "./auth.service.ts";

@Module({
  imports: [
    RolesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("jwt.secret"),
        signOptions: {
          expiresIn: config.get<string>("jwt.expiresIn", "1d") as `${number}d`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthBootstrapService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

