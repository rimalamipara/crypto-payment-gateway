import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomInt } from "node:crypto";

import { gteUsd, normalizeUsd } from "../wallet/wallet.math.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import {
  COLOR_BET_STATUS,
  COLOR_ROUND_STATUS,
} from "./color-game.constants.ts";
import {
  calcPayout,
  formatPeriodName,
  colorsForNumber,
  colorsToString,
  isValidSelection,
  LOCK_MS,
  ROUND_MS,
  pickProfitMaximizingResult,
  type BetType,
} from "./color-game.rules.ts";
import { ColorGameRepository } from "./color-game.repository.ts";
import type { PlaceColorBetDto } from "./dto/color-game.dto.ts";

@Injectable()
export class ColorGameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ColorGameService.name);
  private tickTimer?: ReturnType<typeof setInterval>;
  private settling = false;
  /** Preset for the round after the current one (when current already locked). */
  private queuedPreset: number | null = null;

  constructor(
    @Inject(ColorGameRepository) private readonly repo: ColorGameRepository,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureOpenRound();
    this.tickTimer = setInterval(() => {
      void this.tick().catch((err) =>
        this.logger.warn(`color tick: ${String(err)}`),
      );
    }, 500);
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private async ensureOpenRound(): Promise<void> {
    const open = await this.repo.findOpenRound();
    if (!open) {
      await this.startNextRound();
      return;
    }
    // Resync short leftover rounds (e.g. after duration config change) to full 3 minutes.
    const span =
      new Date(open.revealsAt).getTime() - new Date(open.startsAt).getTime();
    if (
      span < ROUND_MS * 0.9 &&
      (open.status === COLOR_ROUND_STATUS.BETTING ||
        open.status === COLOR_ROUND_STATUS.LOCKED)
    ) {
      const starts = Date.now();
      await this.repo.updateRound(open.id, {
        status: COLOR_ROUND_STATUS.BETTING,
        betsCloseAt: new Date(starts + ROUND_MS - LOCK_MS).toISOString(),
        revealsAt: new Date(starts + ROUND_MS).toISOString(),
      });
    }
  }

  private async startNextRound(preset?: number | null): Promise<void> {
    const periodNo = (await this.repo.maxPeriodNo()) + 1;
    const starts = Date.now();
    const revealsAt = starts + ROUND_MS;
    const betsCloseAt = revealsAt - LOCK_MS;
    const applied =
      preset !== undefined && preset !== null
        ? preset
        : this.queuedPreset;
    this.queuedPreset = null;
    await this.repo.createRound({
      periodNo,
      startsAt: new Date(starts).toISOString(),
      betsCloseAt: new Date(betsCloseAt).toISOString(),
      revealsAt: new Date(revealsAt).toISOString(),
      presetNumber: applied,
    });
  }

  private async tick(): Promise<void> {
    if (this.settling) return;

    // Resume payouts if a prior tick crashed after REVEALED but before SETTLED.
    const stuck = await this.repo.findLatestRound();
    if (
      stuck &&
      stuck.status === COLOR_ROUND_STATUS.REVEALED &&
      stuck.resultNumber != null
    ) {
      const pending = await this.repo.listPendingBets(stuck.id);
      if (pending.length > 0) {
        await this.revealAndSettle(stuck.id, stuck.resultNumber, false);
        return;
      }
      await this.repo.updateRound(stuck.id, {
        status: COLOR_ROUND_STATUS.SETTLED,
        settledAt: this.nowIso(),
      });
      await this.startNextRound();
      return;
    }

    const round = await this.repo.findOpenRound();
    if (!round) {
      await this.startNextRound();
      return;
    }

    const now = Date.now();
    const closeAt = new Date(round.betsCloseAt).getTime();
    const revealAt = new Date(round.revealsAt).getTime();

    if (
      round.status === COLOR_ROUND_STATUS.BETTING &&
      now >= closeAt &&
      now < revealAt
    ) {
      await this.repo.updateRound(round.id, {
        status: COLOR_ROUND_STATUS.LOCKED,
      });
      return;
    }

    if (
      (round.status === COLOR_ROUND_STATUS.BETTING ||
        round.status === COLOR_ROUND_STATUS.LOCKED) &&
      now >= revealAt
    ) {
      // No manual reveal → auto-reveal with preset / house pick.
      await this.revealAndSettle(round.id, null, false);
    }
  }

  /**
   * Admin preset/force still wins. Otherwise pick the digit that pays out
   * the least to players (house-favoring WinGo settle).
   */
  private pickResult(
    preset: number | null | undefined,
    bets: Array<{ betType: string; selection: string; amountUsd: string | number }>,
  ): number {
    if (
      preset !== null &&
      preset !== undefined &&
      Number.isInteger(preset) &&
      preset >= 0 &&
      preset <= 9
    ) {
      return preset;
    }
    return pickProfitMaximizingResult(bets, (n) => randomInt(0, n));
  }

  private async revealAndSettle(
    roundId: number,
    forcedNumber: number | null,
    forcedByAdmin: boolean,
  ): Promise<void> {
    if (this.settling) return;
    this.settling = true;
    try {
      const round = await this.repo.findRound(roundId);
      if (!round) return;
      if (round.status === COLOR_ROUND_STATUS.SETTLED) {
        return;
      }

      const bets = await this.repo.listPendingBets(roundId);

      let resultNumber = round.resultNumber;
      if (round.status !== COLOR_ROUND_STATUS.REVEALED || resultNumber == null) {
        resultNumber =
          forcedNumber !== null
            ? forcedNumber
            : this.pickResult(round.presetNumber, bets);
        const resultColors = colorsToString(colorsForNumber(resultNumber));
        await this.repo.updateRound(roundId, {
          status: COLOR_ROUND_STATUS.REVEALED,
          resultNumber,
          resultColors,
          forcedByAdmin: forcedByAdmin || !!round.forcedByAdmin,
          revealsAt: this.nowIso(),
        });
      }
      for (const bet of bets) {
        const payout = calcPayout(
          bet.betType as BetType,
          bet.selection,
          Number(bet.amountUsd),
          resultNumber!,
        );
        if (payout > 0) {
          // Credit before marking WON so a crash mid-loop still leaves the bet
          // pending (or idempotent win credit) for the next resume tick.
          await this.wallet.creditColorWin({
            userId: bet.userId,
            amountUsd: payout,
            betId: bet.id,
            description: `Color win period #${round.periodNo}`,
          });
          await this.repo.updateBet(bet.id, {
            status: COLOR_BET_STATUS.WON,
            payoutUsd: normalizeUsd(payout),
          });
        } else {
          await this.repo.updateBet(bet.id, {
            status: COLOR_BET_STATUS.LOST,
            payoutUsd: "0",
          });
        }
      }

      // Repair legacy crash order (marked WON before credit): re-credit is idempotent.
      const allBets = await this.repo.listBetsForRound(roundId);
      for (const bet of allBets) {
        if (bet.status !== COLOR_BET_STATUS.WON) continue;
        const amount = Number(bet.payoutUsd);
        if (!(amount > 0)) continue;
        await this.wallet.creditColorWin({
          userId: bet.userId,
          amountUsd: amount,
          betId: bet.id,
          description: `Color win period #${round.periodNo}`,
        });
      }

      await this.repo.updateRound(roundId, {
        status: COLOR_ROUND_STATUS.SETTLED,
        settledAt: this.nowIso(),
      });

      await this.startNextRound();
    } finally {
      this.settling = false;
    }
  }

  private toPublicRound(round: {
    id: number;
    periodNo: number;
    status: string;
    resultNumber: number | null;
    resultColors: string | null;
    startsAt: string;
    betsCloseAt: string;
    revealsAt: string;
    settledAt: string | null;
    presetNumber?: number | null;
    forcedByAdmin?: boolean;
  }, admin = false) {
    const now = Date.now();
    const showResult =
      round.status === COLOR_ROUND_STATUS.REVEALED ||
      round.status === COLOR_ROUND_STATUS.SETTLED;
    return {
      id: round.id,
      periodNo: round.periodNo,
      periodName: formatPeriodName(round.startsAt, round.periodNo),
      status: round.status,
      resultNumber: showResult ? round.resultNumber : null,
      resultColors: showResult ? round.resultColors : null,
      startsAt: round.startsAt,
      betsCloseAt: round.betsCloseAt,
      revealsAt: round.revealsAt,
      settledAt: round.settledAt,
      serverNow: new Date(now).toISOString(),
      msToClose: Math.max(0, new Date(round.betsCloseAt).getTime() - now),
      msToReveal: Math.max(0, new Date(round.revealsAt).getTime() - now),
      ...(admin
        ? {
            presetNumber: round.presetNumber ?? null,
            forcedByAdmin: !!round.forcedByAdmin,
            queuedNextPreset: this.queuedPreset,
          }
        : {}),
    };
  }

  async getCurrent() {
    let round = await this.repo.findOpenRound();
    if (!round) {
      await this.startNextRound();
      round = await this.repo.findOpenRound();
    }
    if (!round) throw new NotFoundException("No active round");
    return this.toPublicRound(round);
  }

  async getCurrentAdmin() {
    let round = await this.repo.findOpenRound();
    if (!round) {
      await this.startNextRound();
      round = await this.repo.findOpenRound();
    }
    if (!round) throw new NotFoundException("No active round");
    const bets = await this.repo.listBetsForRound(round.id);
    const tallies: Record<string, { count: number; amount: number }> = {};
    for (const b of bets) {
      const key = `${b.betType}:${b.selection}`;
      const cur = tallies[key] ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(b.amountUsd);
      tallies[key] = cur;
    }
    const lastSettled = await this.repo.findLatestSettledRound();
    const now = Date.now();
    const revealAt = new Date(round.revealsAt).getTime();
    const openForAdmin =
      round.status === COLOR_ROUND_STATUS.LOCKED ||
      round.status === COLOR_ROUND_STATUS.BETTING;
    // Cancel while locked after bets close, until auto-reveal fires.
    const canCancel =
      openForAdmin &&
      now >= new Date(round.betsCloseAt).getTime() &&
      now < revealAt;
    return {
      round: this.toPublicRound(round, true),
      tallies: Object.entries(tallies).map(([key, v]) => ({
        key,
        count: v.count,
        amountUsd: normalizeUsd(v.amount),
      })),
      pendingBets: bets.filter((b) => b.status === COLOR_BET_STATUS.PENDING)
        .length,
      canCancel,
      canReveal: false,
      holdMsLeft: 0,
      lastResult: lastSettled
        ? {
            periodNo: lastSettled.periodNo,
            periodName: formatPeriodName(
              lastSettled.startsAt,
              lastSettled.periodNo,
            ),
            resultNumber: lastSettled.resultNumber,
            resultColors: lastSettled.resultColors,
            settledAt: lastSettled.settledAt,
          }
        : null,
    };
  }

  /** Serialize color bets per user to avoid full-balance double-spend races. */
  private readonly betChains = new Map<number, Promise<unknown>>();

  async placeBet(userId: number, dto: PlaceColorBetDto) {
    const prev = this.betChains.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((r) => {
      release = r;
    });
    const chained = prev.catch(() => undefined).then(() => done);
    this.betChains.set(userId, chained);
    await prev.catch(() => undefined);
    try {
      return await this.placeBetUnlocked(userId, dto);
    } finally {
      release();
      if (this.betChains.get(userId) === chained) {
        this.betChains.delete(userId);
      }
    }
  }

  private async placeBetUnlocked(userId: number, dto: PlaceColorBetDto) {
    if (!isValidSelection(dto.betType, dto.selection)) {
      throw new BadRequestException("Invalid selection");
    }
    const round = await this.repo.findOpenRound();
    if (!round || round.status !== COLOR_ROUND_STATUS.BETTING) {
      throw new BadRequestException("Betting is closed for this round");
    }
    if (Date.now() >= new Date(round.betsCloseAt).getTime()) {
      throw new BadRequestException(
        "Betting closed — last 30 seconds of the period are locked",
      );
    }

    const amount = normalizeUsd(dto.amountUsd);
    if (!gteUsd(amount, "0.01")) {
      throw new BadRequestException("Minimum bet is $0.01");
    }

    const { balanceAfter: _bal, ...bet } =
      await this.wallet.createColorBetAndDebit({
        userId,
        roundId: round.id,
        betType: dto.betType,
        selection: dto.selection,
        amountUsd: amount,
        description: `Color bet ${dto.betType}:${dto.selection} period #${round.periodNo}`,
      });

    return bet;
  }

  async myBets(userId: number, page = 1, limit = 50) {
    const { items: bets, total } = await this.repo.listMyBetsPage(
      userId,
      page,
      limit,
    );
    const roundIds = [...new Set(bets.map((b) => b.roundId))];
    const roundMeta = new Map<
      number,
      { periodNo: number; startsAt: string; periodName: string }
    >();
    await Promise.all(
      roundIds.map(async (roundId) => {
        const round = await this.repo.findRound(roundId);
        if (round) {
          roundMeta.set(roundId, {
            periodNo: round.periodNo,
            startsAt: round.startsAt,
            periodName: formatPeriodName(round.startsAt, round.periodNo),
          });
        }
      }),
    );
    const items = bets.map((b) => {
      const meta = roundMeta.get(b.roundId);
      return {
        ...b,
        periodNo: meta?.periodNo ?? null,
        startsAt: meta?.startsAt ?? null,
        periodName: meta?.periodName ?? null,
      };
    });
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async recentRounds(limit = 10, page = 1) {
    const { items, total, page: p, limit: l } =
      await this.repo.listRecentRounds(limit, page);
    return {
      items: items.map((r) => ({
        ...r,
        periodName: formatPeriodName(r.startsAt, r.periodNo),
      })),
      total,
      page: p,
      limit: l,
      totalPages: Math.max(1, Math.ceil(total / l)),
    };
  }

  /**
   * Queue winning number for the current round if still betting/locked,
   * otherwise queue for the next round.
   */
  async adminPreset(number: number) {
    if (!Number.isInteger(number) || number < 0 || number > 9) {
      throw new BadRequestException("number must be 0-9");
    }
    const round = await this.repo.findOpenRound();
    if (
      round &&
      (round.status === COLOR_ROUND_STATUS.BETTING ||
        round.status === COLOR_ROUND_STATUS.LOCKED)
    ) {
      await this.repo.updateRound(round.id, { presetNumber: number });
      return {
        ok: true,
        appliedTo: "current",
        periodNo: round.periodNo,
        number,
      };
    }
    this.queuedPreset = number;
    return { ok: true, appliedTo: "next", number };
  }

  /**
   * Settle current round with the given number (admin override).
   * Prefer setting a preset — the tick auto-reveals when reveal time ends.
   */
  async adminReveal(number: number) {
    if (!Number.isInteger(number) || number < 0 || number > 9) {
      throw new BadRequestException("number must be 0-9");
    }
    const round = await this.repo.findOpenRound();
    if (!round) throw new BadRequestException("No open round");
    if (
      round.status !== COLOR_ROUND_STATUS.BETTING &&
      round.status !== COLOR_ROUND_STATUS.LOCKED
    ) {
      throw new BadRequestException("Round is not open for reveal");
    }
    await this.revealAndSettle(round.id, number, true);
    return { ok: true, periodNo: round.periodNo, number };
  }

  /** @deprecated Prefer adminReveal — kept for older clients. */
  async adminForceReveal(number: number) {
    return this.adminReveal(number);
  }

  /**
   * Cancel the draw after bets close (locked) and before auto-reveal:
   * refund pending bets, mark cancelled, start next period.
   */
  async adminCancelDraw() {
    const round = await this.repo.findOpenRound();
    if (!round) throw new BadRequestException("No open round");
    const now = Date.now();
    if (now < new Date(round.betsCloseAt).getTime()) {
      throw new BadRequestException(
        "Cancel is only available after bets close",
      );
    }
    if (now >= new Date(round.revealsAt).getTime()) {
      throw new BadRequestException(
        "Reveal time already ended — round is settling",
      );
    }
    if (
      round.status !== COLOR_ROUND_STATUS.BETTING &&
      round.status !== COLOR_ROUND_STATUS.LOCKED
    ) {
      throw new BadRequestException("Round cannot be cancelled");
    }
    if (this.settling) {
      throw new BadRequestException("Round is already settling");
    }
    this.settling = true;
    try {
      const pending = await this.repo.listPendingBets(round.id);
      for (const bet of pending) {
        await this.wallet.creditColorRefund({
          userId: bet.userId,
          amountUsd: bet.amountUsd,
          betId: bet.id,
          description: `Color cancel period #${round.periodNo}`,
        });
        await this.repo.updateBet(bet.id, {
          status: COLOR_BET_STATUS.REFUNDED,
          payoutUsd: "0",
        });
      }
      await this.repo.updateRound(round.id, {
        status: COLOR_ROUND_STATUS.CANCELLED,
        settledAt: this.nowIso(),
        resultNumber: null,
        resultColors: null,
        forcedByAdmin: true,
      });
      await this.startNextRound();
      return { ok: true, periodNo: round.periodNo, refunded: pending.length };
    } finally {
      this.settling = false;
    }
  }

  async adminListRounds(page = 1, limit = 50) {
    const { items, total } = await this.repo.listAdminHistoryPage(page, limit);
    const enriched = [];
    for (const r of items) {
      const sums = await this.repo.sumBets(r.id);
      const volume = Number(sums.volume);
      const payout = Number(sums.payout);
      enriched.push({
        ...r,
        ...sums,
        // House P/L for the period: stakes collected − player payouts.
        house: normalizeUsd(volume - payout),
        periodName: formatPeriodName(r.startsAt, r.periodNo),
      });
    }
    return {
      items: enriched,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async adminOverview() {
    return this.repo.overviewStats();
  }
}
