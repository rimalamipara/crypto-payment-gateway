import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";

export const NOTIFICATION_TYPE = {
  DEPOSIT: "deposit",
  WITHDRAWAL: "withdrawal",
  BET_RESULT: "bet_result",
  KYC: "kyc",
} as const;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get notifications() {
    return this.prisma.client.orm.public.Notification;
  }

  /** Best effort: a notification failure must never break the money/game flow that triggered it. */
  async notify(userId: number, type: string, title: string, body: string): Promise<void> {
    try {
      await this.notifications.create({ userId, type, title, body });
    } catch (error) {
      this.logger.warn(`notify failed for user ${userId}: ${String(error)}`);
    }
  }

  async list(userId: number, page: number, limit: number, unreadOnly: boolean) {
    const where = unreadOnly ? { userId, read: false } : { userId };
    const [agg, items] = await Promise.all([
      this.notifications.where(where).aggregate((a) => ({ count: a.count() })),
      this.notifications
        .where(where)
        .orderBy((n) => n.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all(),
    ]);
    return { items, page, limit, total: Number(agg.count ?? 0) };
  }

  async unreadCount(userId: number) {
    const agg = await this.notifications
      .where({ userId, read: false })
      .aggregate((a) => ({ count: a.count() }));
    return { unread: Number(agg.count ?? 0) };
  }

  async markRead(userId: number, id: number) {
    const row = await this.notifications.where({ id, userId }).first();
    if (!row) throw new NotFoundException("Notification not found");
    await this.notifications.where({ id }).update({ read: true });
    return { ok: true };
  }

  async markAllRead(userId: number) {
    await this.notifications.where({ userId, read: false }).update({ read: true });
    return { ok: true };
  }
}
