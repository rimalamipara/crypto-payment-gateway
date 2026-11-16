import { Module } from "@nestjs/common";

import { RolesModule } from "../roles/roles.module.ts";
import { UsersController } from "./users.controller.ts";
import { UsersRepository } from "./users.repository.ts";
import { UsersService } from "./users.service.ts";

@Module({
  imports: [RolesModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
