import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module.ts";
import { AdminController } from "./admin.controller.ts";
import { AdminStatsService } from "./admin-stats.service.ts";

@Module({
  imports: [UsersModule],
  controllers: [AdminController],
  providers: [AdminStatsService],
})
export class AdminModule {}
