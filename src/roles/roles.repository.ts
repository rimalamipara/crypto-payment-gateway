import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";

export interface RoleRecord {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

@Injectable()
export class RolesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByName(name: string): Promise<RoleRecord | null> {
    const role = await this.prisma.client.orm.public.Role.where({ name })
      .select("id", "name", "description", "isActive", "createdAt")
      .first();

    return role
      ? {
          id: role.id,
          name: role.name,
          description: role.description ?? null,
          isActive: role.isActive,
          createdAt: role.createdAt,
        }
      : null;
  }

  async findAll(): Promise<RoleRecord[]> {
    const roles = await this.prisma.client.orm.public.Role.select(
      "id",
      "name",
      "description",
      "isActive",
      "createdAt",
    )
      .orderBy((role) => role.name.asc())
      .all();

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description ?? null,
      isActive: role.isActive,
      createdAt: role.createdAt,
    }));
  }

  async create(name: string, description?: string): Promise<RoleRecord> {
    const existing = await this.findByName(name);
    if (existing) {
      throw new ConflictException(`Role "${name}" already exists`);
    }

    const created = await this.prisma.client.orm.public.Role.create({
      name,
      description: description ?? null,
      isActive: true,
    });

    return {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      isActive: created.isActive,
      createdAt: created.createdAt,
    };
  }

  async ensureRole(name: string, description?: string): Promise<RoleRecord> {
    const existing = await this.findByName(name);
    if (existing) {
      return existing;
    }
    return this.create(name, description);
  }

  async getUserRoleNames(userId: number): Promise<string[]> {
    const rows = await this.prisma.client.orm.public.UserRole.where({ userId })
      .include("role", (role) => role.select("name", "isActive"))
      .all();

    return rows
      .filter((row) => row.role?.isActive)
      .map((row) => row.role.name);
  }

  async assignRole(userId: number, roleName: string): Promise<void> {
    const role = await this.findByName(roleName);
    if (!role || !role.isActive) {
      throw new NotFoundException(`Role "${roleName}" not found`);
    }

    const user = await this.prisma.client.orm.public.User.where({ id: userId })
      .select("id")
      .first();
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const existing = await this.prisma.client.orm.public.UserRole.where({
      userId,
      roleId: role.id,
    })
      .select("id")
      .first();

    if (!existing) {
      await this.prisma.client.orm.public.UserRole.create({
        userId,
        roleId: role.id,
      });
    }
  }

  async revokeRole(userId: number, roleName: string): Promise<void> {
    const role = await this.findByName(roleName);
    if (!role) {
      throw new NotFoundException(`Role "${roleName}" not found`);
    }

    await this.prisma.client.orm.public.UserRole.where({
      userId,
      roleId: role.id,
    }).delete();
  }
}
