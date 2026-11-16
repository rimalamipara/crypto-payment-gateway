import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { RolesService } from "../roles/roles.service.ts";
import type { CreateAdminDto } from "./dto/create-admin.dto.ts";
import type { UserResponseDto } from "./dto/user-response.dto.ts";
import { UsersRepository } from "./users.repository.ts";

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RolesService) private readonly rolesService: RolesService,
  ) {}

  async findAll(page = 1, limit = 10) {
    const { items, total } = await this.usersRepository.findAllPage(
      page,
      limit,
    );
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async createAdmin(dto: CreateAdminDto): Promise<UserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.client.orm.public.User.where({ email })
      .select("id")
      .first();

    if (existing) {
      throw new ConflictException("Email is already registered");
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.client.orm.public.User.create({
      email,
      passwordHash,
      username: dto.username?.trim() || null,
      name: dto.name?.trim() || null,
      isActive: true,
    });

    await this.rolesService.ensureDefaultUserRole(created.id);
    await this.rolesService.assign({
      userId: created.id,
      roleName: DEFAULT_ROLES.ADMIN,
    });

    const user = await this.usersRepository.findById(created.id);
    if (!user) {
      throw new ConflictException("Admin user was created but could not be loaded");
    }
    return user;
  }

  async softDelete(
    targetId: number,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (actor.id === targetId) {
      throw new BadRequestException("You cannot soft-delete your own account");
    }

    const target = await this.usersRepository.findById(targetId);
    if (!target) {
      throw new NotFoundException(`User ${targetId} not found`);
    }
    if (!target.isActive) {
      return target;
    }

    return this.usersRepository.softDelete(targetId);
  }

  async restore(targetId: number): Promise<UserResponseDto> {
    const target = await this.usersRepository.findById(targetId);
    if (!target) {
      throw new NotFoundException(`User ${targetId} not found`);
    }
    if (target.isActive) {
      return target;
    }
    return this.usersRepository.restore(targetId);
  }
}
