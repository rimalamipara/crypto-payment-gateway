import { Module } from "@nestjs/common";

import { RolesController } from "./roles.controller.ts";
import { RolesRepository } from "./roles.repository.ts";
import { RolesService } from "./roles.service.ts";

@Module({
  controllers: [RolesController],
  providers: [RolesService, RolesRepository],
  exports: [RolesService],
})
export class RolesModule {}
