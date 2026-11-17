import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";

@Injectable()
export class GameSettingsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get orm() {
    return this.prisma.client.orm.public;
  }

  list() {
    return this.orm.GameSetting.all();
  }

  /** Create the row if the game has none yet, otherwise update it. */
  async setEnabled(game: string, enabled: boolean): Promise<void> {
    const existing = await this.orm.GameSetting.where({ game }).first();
    if (existing) {
      await this.orm.GameSetting.where({ id: existing.id }).update({ enabled });
    } else {
      await this.orm.GameSetting.create({ game, enabled });
    }
  }
}
