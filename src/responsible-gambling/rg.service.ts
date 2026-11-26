import { ForbiddenException, Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { WALLET_TX_TYPE } from "../wallet/constants/wallet-tx-type.ts";
import type { SetLimitsDto } from "./dto/rg.dto.ts";
import {
  depositBlockReason,
  PERMANENT_EXCLUSION,
  playBlockReason,
  type RgSettings,
} from "./rg.rules.ts";

const DAY_MS = 86_400_000;
const T = WALLET_TX_TYPE;
const GAME_DEBITS = new Set<string>([
  T.DEBIT_COLOR_BET, T.DEBIT_POKER_BUYIN, T.DEBIT_TEEN_BUYIN, T.DEBIT_RUMMY_BUYIN,
  T.DEBIT_POKER_HAND, T.DEBIT_TEEN_HAND, T.DEBIT_RUMMY_HAND,
]);
const GAME_CREDITS = new Set<string>([
  T.CREDIT_COLOR_WIN, T.CREDIT_COLOR_REFUND, T.CREDIT_POKER_CASHOUT, T.CREDIT_TEEN_CASHOUT,
  T.CREDIT_RUMMY_CASHOUT, T.CREDIT_POKER_HAND, T.CREDIT_TEEN_HAND, T.CREDIT_RUMMY_HAND,
]);

@Injectable()
export class ResponsibleGamblingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get orm() {
    return this.prisma.client.orm.public;
  }

  private async load(userId: number): Promise<RgSettings> {
    const r = await this.orm.ResponsibleGambling.where({ userId }).first();
    return {
      dailyDepositLimitUsd: r?.dailyDepositLimitUsd != null ? Number(r.dailyDepositLimitUsd) : null,
      dailyLossLimitUsd: r?.dailyLossLimitUsd != null ? Number(r.dailyLossLimitUsd) : null,
      coolingOffUntil: r?.coolingOffUntil ? new Date(r.coolingOffUntil) : null,
      selfExcludedUntil: r?.selfExcludedUntil ? new Date(r.selfExcludedUntil) : null,
    };
  }

  private async upsert(userId: number, data: Record<string, unknown>) {
    const existing = await this.orm.ResponsibleGambling.where({ userId }).first();
    if (existing) await this.orm.ResponsibleGambling.where({ id: existing.id }).update(data);
    else await this.orm.ResponsibleGambling.create({ userId, ...data });
    return this.get(userId);
  }

  /** Wallet rows of the last 24h for this user. */
  private async recentTx(userId: number) {
    const wallet = await this.orm.Wallet.where({ userId }).select("id").first();
    if (!wallet) return [];
    const since = new Date(Date.now() - DAY_MS).toISOString();
    return this.orm.WalletTransaction.where({ walletId: wallet.id })
      .where((t) => t.createdAt.gte(since))
      .all();
  }

  async get(userId: number) {
    const s = await this.load(userId);
    return {
      ...s,
      selfExcludedPermanently: s.selfExcludedUntil?.getTime() === PERMANENT_EXCLUSION.getTime(),
    };
  }

  setLimits(userId: number, dto: SetLimitsDto) {
    // shortcut: limit increases apply immediately; add a 24h delay if regulators require it.
    const data: Record<string, unknown> = {};
    if (dto.dailyDepositLimitUsd !== undefined) data.dailyDepositLimitUsd = dto.dailyDepositLimitUsd === null ? null : String(dto.dailyDepositLimitUsd);
    if (dto.dailyLossLimitUsd !== undefined) data.dailyLossLimitUsd = dto.dailyLossLimitUsd === null ? null : String(dto.dailyLossLimitUsd);
    return this.upsert(userId, data);
  }

  async coolOff(userId: number, days: number) {
    const until = new Date(Date.now() + days * DAY_MS);
    const cur = (await this.load(userId)).coolingOffUntil;
    // never shorten an active period
    return this.upsert(userId, { coolingOffUntil: (cur && cur > until ? cur : until).toISOString() });
  }

  async selfExclude(userId: number, days: number) {
    const until = days === 0 ? PERMANENT_EXCLUSION : new Date(Date.now() + days * DAY_MS);
    const cur = (await this.load(userId)).selfExcludedUntil;
    return this.upsert(userId, { selfExcludedUntil: (cur && cur > until ? cur : until).toISOString() });
  }

  /** Call before any money enters play (bets, table buy-ins). */
  async assertCanPlay(userId: number): Promise<void> {
    const s = await this.load(userId);
    let netLoss = 0;
    if (s.dailyLossLimitUsd !== null) {
      for (const r of await this.recentTx(userId)) {
        const amt = Number(r.amountUsd);
        if (GAME_DEBITS.has(r.type)) netLoss += amt;
        else if (GAME_CREDITS.has(r.type)) netLoss -= amt;
      }
    }
    const reason = playBlockReason(s, netLoss);
    if (reason) throw new ForbiddenException(reason);
  }

  async assertCanDeposit(userId: number, amountUsd: number): Promise<void> {
    const s = await this.load(userId);
    let deposited = 0;
    if (s.dailyDepositLimitUsd !== null) {
      for (const r of await this.recentTx(userId)) {
        if (r.type === T.CREDIT_TOPUP) deposited += Number(r.amountUsd);
      }
    }
    const reason = depositBlockReason(s, deposited, amountUsd);
    if (reason) throw new ForbiddenException(reason);
  }
}
