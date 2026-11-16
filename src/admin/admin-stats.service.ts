import { Inject, Injectable } from "@nestjs/common";

import { PAYMENT_STATUS } from "../payments/constants/payment-status.ts";
import { PAYOUT_STATUS } from "../payouts/constants/payout-status.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd, subUsd } from "../wallet/wallet.math.ts";
import type { AdminStatsDto } from "./dto/admin-stats.dto.ts";

@Injectable()
export class AdminStatsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOverview(): Promise<AdminStatsDto> {
    const db = this.prisma.client.orm.public;

    const [
      paymentsAll,
      paymentsPaid,
      paymentsManual,
      paymentsPending,
      paymentsExpired,
      payoutsAll,
      payoutsConfirmed,
      payoutsProcessing,
      payoutsFailed,
      wallets,
      users,
    ] = await Promise.all([
      db.Payment.aggregate((a) => ({
        count: a.count(),
        amountUsd: a.sum("amount"),
      })),
      db.Payment.where((p) => p.status.eq(PAYMENT_STATUS.PAID)).aggregate(
        (a) => ({
          count: a.count(),
          amountUsd: a.sum("amount"),
        }),
      ),
      db.Payment.where((p) =>
        p.status.eq(PAYMENT_STATUS.MANUAL_ACCEPT),
      ).aggregate((a) => ({
        count: a.count(),
        amountUsd: a.sum("amount"),
      })),
      db.Payment.where((p) =>
        p.status.in([
          PAYMENT_STATUS.NEW,
          PAYMENT_STATUS.WAITING,
          PAYMENT_STATUS.PAYING,
        ]),
      ).aggregate((a) => ({
        count: a.count(),
        amountUsd: a.sum("amount"),
      })),
      db.Payment.where((p) => p.status.eq(PAYMENT_STATUS.EXPIRED)).aggregate(
        (a) => ({
          count: a.count(),
        }),
      ),
      db.Payout.aggregate((a) => ({
        count: a.count(),
        amountUsd: a.sum("amountUsd"),
      })),
      db.Payout.where((p) => p.status.eq(PAYOUT_STATUS.CONFIRMED)).aggregate(
        (a) => ({
          count: a.count(),
          amountUsd: a.sum("amountUsd"),
        }),
      ),
      db.Payout.where((p) =>
        p.status.in([
          PAYOUT_STATUS.PENDING,
          PAYOUT_STATUS.PROCESSING,
          PAYOUT_STATUS.CONFIRMING,
        ]),
      ).aggregate((a) => ({
        count: a.count(),
        amountUsd: a.sum("amountUsd"),
      })),
      db.Payout.where((p) => p.status.eq(PAYOUT_STATUS.FAILED)).aggregate(
        (a) => ({
          count: a.count(),
          amountUsd: a.sum("amountUsd"),
        }),
      ),
      db.Wallet.aggregate((a) => ({
        count: a.count(),
        balanceUsd: a.sum("balanceUsd"),
      })),
      db.User.aggregate((a) => ({
        count: a.count(),
      })),
    ]);

    const paidCount = paymentsPaid.count + paymentsManual.count;
    const paidAmountUsd = normalizeUsd(
      Number(paymentsPaid.amountUsd ?? 0) + Number(paymentsManual.amountUsd ?? 0),
    );
    const confirmedAmountUsd = normalizeUsd(payoutsConfirmed.amountUsd ?? 0);

    return {
      payments: {
        totalCount: paymentsAll.count,
        totalAmountUsd: normalizeUsd(paymentsAll.amountUsd ?? 0),
        paidCount,
        paidAmountUsd,
        pendingCount: paymentsPending.count,
        pendingAmountUsd: normalizeUsd(paymentsPending.amountUsd ?? 0),
        expiredCount: paymentsExpired.count,
      },
      payouts: {
        totalCount: payoutsAll.count,
        totalAmountUsd: normalizeUsd(payoutsAll.amountUsd ?? 0),
        confirmedCount: payoutsConfirmed.count,
        confirmedAmountUsd,
        processingCount: payoutsProcessing.count,
        processingAmountUsd: normalizeUsd(payoutsProcessing.amountUsd ?? 0),
        failedCount: payoutsFailed.count,
        failedAmountUsd: normalizeUsd(payoutsFailed.amountUsd ?? 0),
      },
      wallets: {
        walletCount: wallets.count,
        totalBalanceUsd: normalizeUsd(wallets.balanceUsd ?? 0),
      },
      netVolumeUsd: subUsd(paidAmountUsd, confirmedAmountUsd),
      userCount: users.count,
      currency: "USD",
      generatedAt: new Date().toISOString(),
    };
  }
}
