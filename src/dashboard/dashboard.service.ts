import { Inject, Injectable } from "@nestjs/common";

import { KycService } from "../kyc/kyc.service.ts";
import { NotificationsService } from "../notifications/notifications.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { ResponsibleGamblingService } from "../responsible-gambling/rg.service.ts";
import { WalletService } from "../wallet/wallet.service.ts";

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(KycService) private readonly kyc: KycService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ResponsibleGamblingService) private readonly rg: ResponsibleGamblingService,
  ) {}

  /** One round-trip summary for the user home screen. */
  async get(userId: number) {
    const orm = this.prisma.client.orm.public;
    const [balance, stats, transactions, recentBets, unread, kyc, rg, user] = await Promise.all([
      this.wallet.getBalance(userId),
      this.wallet.getStats(userId),
      this.wallet.listTransactions(userId, 1, 10),
      orm.ColorBet.where({ userId })
        .orderBy((b) => b.id.desc())
        .limit(10)
        .all(),
      this.notifications.unreadCount(userId),
      this.kyc.getMine(userId),
      this.rg.get(userId),
      orm.User.where({ id: userId }).select("twoFactorEnabled").first(),
    ]);

    return {
      balance,
      stats,
      recentTransactions: transactions.items,
      recentBets,
      unreadNotifications: unread.unread,
      kycStatus: kyc.status,
      twoFactorEnabled: user?.twoFactorEnabled ?? false,
      responsibleGambling: rg,
    };
  }
}
