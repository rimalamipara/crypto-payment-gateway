import { Module } from "@nestjs/common";

import { RolesModule } from "../roles/roles.module.ts";
import { ProfileController } from "./profile.controller.ts";
import { ProfileService } from "./profile.service.ts";
import { UsersController } from "./users.controller.ts";
import { UsersRepository } from "./users.repository.ts";
import { UsersService } from "./users.service.ts";

@Module({
  imports: [RolesModule],
  controllers: [UsersController, ProfileController],
  providers: [UsersService, UsersRepository, ProfileService],
  exports: [UsersService],
})
export class UsersModule {}
