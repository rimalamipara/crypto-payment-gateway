import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { RolesService } from "../roles/roles.service.ts";

@Injectable()
export class AuthBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AuthBootstrapService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RolesService) private readonly rolesService: RolesService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.configService.get<string>("admin.email")?.trim().toLowerCase();
    const password = this.configService.get<string>("admin.password");
    if (!email || !password) {
      return;
    }

    let user = await this.prisma.client.orm.public.User.where({ email })
      .select("id", "email")
      .first();

    if (!user) {
      const passwordHash = await bcrypt.hash(password, 12);
      user = await this.prisma.client.orm.public.User.create({
        email,
        passwordHash,
        username: "admin",
        name: "Administrator",
        isActive: true,
      });
      this.logger.log(`Bootstrap admin user created: ${email}`);
    }

    await this.rolesService.ensureDefaultUserRole(user.id);
    await this.rolesService.assign({
      userId: user.id,
      roleName: DEFAULT_ROLES.ADMIN,
    });
    this.logger.log(`Bootstrap admin role ensured for: ${email}`);
  }
}
