import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import type { AssignRoleDto } from "./dto/assign-role.dto.ts";
import type { CreateRoleDto } from "./dto/create-role.dto.ts";
import { RolesRepository, type RoleRecord } from "./roles.repository.ts";

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @Inject(RolesRepository) private readonly rolesRepository: RolesRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rolesRepository.ensureRole(
      DEFAULT_ROLES.USER,
      "Default application user",
    );
    await this.rolesRepository.ensureRole(
      DEFAULT_ROLES.ADMIN,
      "Administrator with elevated access",
    );
  }

  create(dto: CreateRoleDto): Promise<RoleRecord> {
    return this.rolesRepository.create(dto.name, dto.description);
  }

  findAll(): Promise<RoleRecord[]> {
    return this.rolesRepository.findAll();
  }

  getUserRoleNames(userId: number): Promise<string[]> {
    return this.rolesRepository.getUserRoleNames(userId);
  }

  assign(dto: AssignRoleDto): Promise<void> {
    return this.rolesRepository.assignRole(dto.userId, dto.roleName);
  }

  revoke(dto: AssignRoleDto): Promise<void> {
    return this.rolesRepository.revokeRole(dto.userId, dto.roleName);
  }

  ensureDefaultUserRole(userId: number): Promise<void> {
    return this.rolesRepository.assignRole(userId, DEFAULT_ROLES.USER);
  }
}
