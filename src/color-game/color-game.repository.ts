import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import {
  COLOR_BET_STATUS,
  COLOR_ROUND_STATUS,
} from "./color-game.constants.ts";

@Injectable()
export class ColorGameRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get orm() {
    return this.prisma.client.orm.public;
  }

  async findRound(id: number) {
    return this.orm.ColorRound.where({ id }).first();
  }

  async findByPeriod(periodNo: number) {
    return this.orm.ColorRound.where({ periodNo }).first();
  }

  async findOpenRound(durationSec: number) {
    const betting = await this.orm.ColorRound.where({
      status: COLOR_ROUND_STATUS.BETTING,
      durationSec,
    })
      .orderBy((r) => r.periodNo.desc())
      .first();
    if (betting) return betting;
    return this.orm.ColorRound.where({
      status: COLOR_ROUND_STATUS.LOCKED,
      durationSec,
    })
      .orderBy((r) => r.periodNo.desc())
      .first();
  }

  async findLatestRound(durationSec: number) {
    return this.orm.ColorRound.where({ durationSec })
      .orderBy((r) => r.periodNo.desc())
      .first();
  }

  async maxPeriodNo(): Promise<number> {
    const row = await this.orm.ColorRound.orderBy((r) =>
      r.periodNo.desc(),
    ).first();
    return row?.periodNo ?? 0;
  }

  async createRound(data: {
    periodNo: number;
    startsAt: string;
    betsCloseAt: string;
    revealsAt: string;
    durationSec: number;
    presetNumber?: number | null;
  }) {
    return this.orm.ColorRound.create({
      periodNo: data.periodNo,
      status: COLOR_ROUND_STATUS.BETTING,
      startsAt: data.startsAt,
      betsCloseAt: data.betsCloseAt,
      revealsAt: data.revealsAt,
      durationSec: data.durationSec,
      forcedByAdmin: false,
      presetNumber: data.presetNumber ?? null,
    });
  }

  async updateRound(
    id: number,
    data: Partial<{
      status: string;
      resultNumber: number | null;
      resultColors: string | null;
      settledAt: string | null;
      forcedByAdmin: boolean;
      presetNumber: number | null;
      betsCloseAt: string;
      revealsAt: string;
    }>,
  ) {
    await this.orm.ColorRound.where({ id }).update(data);
    return this.findRound(id);
  }

  async createBet(data: {
    roundId: number;
    userId: number;
    betType: string;
    selection: string;
    amountUsd: string;
  }) {
    return this.orm.ColorBet.create({
      roundId: data.roundId,
      userId: data.userId,
      betType: data.betType,
      selection: data.selection,
      amountUsd: data.amountUsd,
      payoutUsd: "0",
      status: COLOR_BET_STATUS.PENDING,
    });
  }

  async updateBet(
    id: number,
    data: Partial<{ payoutUsd: string; status: string }>,
  ) {
    await this.orm.ColorBet.where({ id }).update(data);
  }

  async listPendingBets(roundId: number) {
    return this.orm.ColorBet.where({
      roundId,
      status: COLOR_BET_STATUS.PENDING,
    }).all();
  }

  async listBetsForRound(roundId: number) {
    return this.orm.ColorBet.where({ roundId }).all();
  }

  async listMyBets(userId: number, limit = 50) {
    return this.orm.ColorBet.where({ userId })
      .orderBy((b) => b.createdAt.desc())
      .limit(limit)
      .all();
  }

  async listMyBetsPage(userId: number, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [agg, items] = await Promise.all([
      this.orm.ColorBet.where({ userId }).aggregate((a) => ({
        count: a.count(),
      })),
      this.orm.ColorBet.where({ userId })
        .orderBy((b) => b.createdAt.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    return { items, total: Number(agg.count ?? 0) };
  }

  async listRecentRounds(durationSec: number, limit = 10, page = 1) {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;
    const settled = { status: COLOR_ROUND_STATUS.SETTLED, durationSec };

    const [agg, items] = await Promise.all([
      this.orm.ColorRound.where(settled).aggregate((a) => ({
        count: a.count(),
      })),
      this.orm.ColorRound.where(settled)
        .orderBy((r) => r.periodNo.desc())
        .offset(offset)
        .limit(safeLimit)
        .all(),
    ]);

    return {
      items,
      total: Number(agg.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async listRoundsPage(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [agg, items] = await Promise.all([
      this.orm.ColorRound.aggregate((a) => ({ count: a.count() })),
      this.orm.ColorRound.orderBy((r) => r.periodNo.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    return { items, total: Number(agg.count ?? 0) };
  }

  /** Completed draws for admin history (settled + cancelled). */
  async listAdminHistoryPage(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const all = await this.orm.ColorRound.orderBy((r) => r.periodNo.desc()).all();
    const done = all.filter(
      (r) =>
        r.status === COLOR_ROUND_STATUS.SETTLED ||
        r.status === COLOR_ROUND_STATUS.CANCELLED,
    );
    return {
      items: done.slice(offset, offset + limit),
      total: done.length,
    };
  }

  async findLatestSettledRound(durationSec: number) {
    return this.orm.ColorRound.where({
      status: COLOR_ROUND_STATUS.SETTLED,
      durationSec,
    })
      .orderBy((r) => r.periodNo.desc())
      .first();
  }

  async sumBets(roundId: number): Promise<{ volume: string; payout: string }> {
    const bets = await this.listBetsForRound(roundId);
    let volume = 0;
    let payout = 0;
    for (const b of bets) {
      volume += Number(b.amountUsd);
      payout += Number(b.payoutUsd);
    }
    return {
      volume: normalizeUsd(volume),
      payout: normalizeUsd(payout),
    };
  }

  async overviewStats() {
    const bets = await this.orm.ColorBet.all();
    let volume = 0;
    let payouts = 0;
    for (const b of bets) {
      volume += Number(b.amountUsd);
      payouts += Number(b.payoutUsd);
    }
    const rounds = await this.orm.ColorRound.aggregate((a) => ({
      count: a.count(),
    }));
    return {
      totalBets: bets.length,
      totalRounds: Number(rounds.count ?? 0),
      volume: normalizeUsd(volume),
      payouts: normalizeUsd(payouts),
      house: normalizeUsd(volume - payouts),
    };
  }
}
