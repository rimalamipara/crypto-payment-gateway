import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";

import { PrismaService } from "../prisma/prisma.service.ts";
import { RolesService } from "../roles/roles.service.ts";
import type { LoginDto } from "./dto/login.dto.ts";
import type { RegisterDto } from "./dto/register.dto.ts";

export interface AuthUserView {
  id: number;
  email: string;
  username: string | null;
  name: string | null;
  roles: string[];
}

export interface AuthTokensResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: string;
  user: AuthUserView;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RolesService) private readonly rolesService: RolesService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokensResponse> {
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
    const roles = await this.rolesService.getUserRoleNames(created.id);

    return this.buildAuthResponse({
      id: created.id,
      email: created.email,
      username: created.username ?? null,
      name: created.name ?? null,
      roles,
    });
  }

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.client.orm.public.User.where({ email })
      .select(
        "id",
        "email",
        "username",
        "name",
        "passwordHash",
        "isActive",
      )
      .first();

    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const roles = await this.rolesService.getUserRoleNames(user.id);
    return this.buildAuthResponse({
      id: user.id,
      email: user.email,
      username: user.username ?? null,
      name: user.name ?? null,
      roles,
    });
  }

  async getProfile(userId: number): Promise<AuthUserView> {
    const user = await this.prisma.client.orm.public.User.where({ id: userId })
      .select("id", "email", "username", "name", "isActive")
      .first();

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User not found or inactive");
    }

    const roles = await this.rolesService.getUserRoleNames(user.id);
    return {
      id: user.id,
      email: user.email,
      username: user.username ?? null,
      name: user.name ?? null,
      roles,
    };
  }

  private async buildAuthResponse(user: AuthUserView): Promise<AuthTokensResponse> {
    const expiresIn = this.configService.get<string>("jwt.expiresIn", "1d");
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles: user.roles,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
      user,
    };
  }
}
