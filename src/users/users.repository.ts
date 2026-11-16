import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import type { UserResponseDto } from "./dto/user-response.dto.ts";

@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAllPage(
    page: number,
    limit: number,
  ): Promise<{ items: UserResponseDto[]; total: number }> {
    const offset = (page - 1) * limit;
    const [agg, users] = await Promise.all([
      this.prisma.client.orm.public.User.aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.User.select(
        "id",
        "email",
        "username",
        "name",
        "isActive",
        "createdAt",
      )
        .include("userRoles", (userRole) =>
          userRole.include("role", (role) => role.select("name", "isActive")),
        )
        .orderBy((user) => user.id.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);

    return {
      items: users.map((user) => this.toResponse(user)),
      total: Number(agg.count ?? 0),
    };
  }

  async findById(id: number): Promise<UserResponseDto | null> {
    const user = await this.prisma.client.orm.public.User.where({ id })
      .select("id", "email", "username", "name", "isActive", "createdAt")
      .include("userRoles", (userRole) =>
        userRole.include("role", (role) => role.select("name", "isActive")),
      )
      .first();

    return user ? this.toResponse(user) : null;
  }

  async softDelete(id: number): Promise<UserResponseDto> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }

    await this.prisma.client.orm.public.User.where({ id }).update({
      isActive: false,
    });

    const updated = await this.findById(id);
    if (!updated) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return updated;
  }

  async restore(id: number): Promise<UserResponseDto> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }

    await this.prisma.client.orm.public.User.where({ id }).update({
      isActive: true,
    });

    const updated = await this.findById(id);
    if (!updated) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return updated;
  }

  private toResponse(user: {
    id: number;
    email: string;
    username: string | null;
    name: string | null;
    isActive: boolean;
    createdAt: string;
    userRoles: Array<{ role: { name: string; isActive: boolean } | null }>;
  }): UserResponseDto {
    return {
      id: String(user.id),
      email: user.email,
      username: user.username ?? null,
      name: user.name ?? null,
      roles: (user.userRoles ?? [])
        .filter((row) => row.role?.isActive)
        .map((row) => row.role!.name),
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}
