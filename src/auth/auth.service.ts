import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";

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

    if (dto.phone && (await this.findByPhone(dto.phone))) {
      throw new ConflictException("Phone is already registered");
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.client.orm.public.User.create({
      email,
      passwordHash,
      username: dto.username?.trim() || null,
      name: dto.name?.trim() || null,
      phone: dto.phone ?? null,
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
    if (!dto.email && !dto.phone) {
      throw new BadRequestException("Provide email or phone");
    }
    const user = dto.phone
      ? await this.findByPhone(dto.phone)
      : await this.prisma.client.orm.public.User.where({
          email: dto.email!.trim().toLowerCase(),
        }).first();

    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.issueFor(user);
  }

  async loginWithGoogle(idToken: string): Promise<AuthTokensResponse> {
    const clientId = this.configService.get<string>("google.clientId", "");
    if (!clientId) {
      throw new BadRequestException("Google login is not configured");
    }
    // shortcut: Google tokeninfo endpoint (one HTTP call per login); switch to local JWKS verify if volume grows.
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    const info = (await res.json().catch(() => ({}))) as {
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
    };
    if (
      !res.ok ||
      info.aud !== clientId ||
      !info.sub ||
      !info.email ||
      String(info.email_verified) !== "true"
    ) {
      throw new UnauthorizedException("Invalid Google token");
    }

    const email = info.email.toLowerCase();
    const orm = this.prisma.client.orm.public.User;
    let user =
      (await orm.where({ googleId: info.sub }).first()) ??
      (await orm.where({ email }).first());

    if (user && !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user && !user.googleId) {
      await orm.where({ id: user.id }).update({ googleId: info.sub });
    }
    if (!user) {
      user = await orm.create({
        email,
        googleId: info.sub,
        name: info.name ?? null,
        // unusable random password: Google-only account
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
        isActive: true,
      });
      await this.rolesService.ensureDefaultUserRole(user.id);
    }
    return this.issueFor(user);
  }

  private findByPhone(phone: string) {
    return this.prisma.client.orm.public.User.where({ phone }).first();
  }

  private async issueFor(user: {
    id: number;
    email: string;
    username?: string | null;
    name?: string | null;
  }): Promise<AuthTokensResponse> {
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
