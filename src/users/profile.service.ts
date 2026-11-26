import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";

import { PrismaService } from "../prisma/prisma.service.ts";
import type { ChangePasswordDto, UpdateProfileDto } from "./dto/profile.dto.ts";

@Injectable()
export class ProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get users() {
    return this.prisma.client.orm.public.User;
  }

  async get(userId: number) {
    const u = await this.users
      .where({ id: userId })
      .select("id", "email", "username", "name", "phone", "country", "avatarUrl", "createdAt")
      .first();
    if (!u) throw new NotFoundException("User not found");
    return u;
  }

  async update(userId: number, dto: UpdateProfileDto) {
    if (dto.phone) {
      const taken = await this.users.where({ phone: dto.phone }).select("id").first();
      if (taken && taken.id !== userId) throw new ConflictException("Phone is already registered");
    }
    const data: Record<string, string> = {};
    for (const k of ["name", "username", "phone", "country", "avatarUrl"] as const) {
      if (dto[k] !== undefined) data[k] = dto[k].trim();
    }
    if (Object.keys(data).length) await this.users.where({ id: userId }).update(data);
    return this.get(userId);
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const u = await this.users.where({ id: userId }).select("passwordHash").first();
    if (!u || !(await bcrypt.compare(dto.currentPassword, u.passwordHash))) {
      throw new BadRequestException("Current password is incorrect");
    }
    await this.users
      .where({ id: userId })
      .update({ passwordHash: await bcrypt.hash(dto.newPassword, 12) });
    return { ok: true };
  }
}
