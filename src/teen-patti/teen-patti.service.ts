import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import { EventEmitter } from "node:events";

import { normalizeUsd } from "../wallet/wallet.math.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import type {
  CreateTpTableDto,
  TpBuyInDto,
  UpdateTpTableDto,
} from "./dto/teen-patti.dto.ts";
import {
  applyAction,
  legalActions,
  publicPlayerView,
  startHand,
  timeoutAction,
  type TeenPattiActionType,
  type TeenPattiHandResult,
  type TeenPattiHandState,
} from "./teen-patti.engine.ts";
import {
  TP_HAND_STATUS,
  TP_SEAT_STATUS,
  TP_TABLE_STATUS,
  TP_TURN_TIMEOUT_MS,
} from "./teen-patti.constants.ts";
import { ResponsibleGamblingService } from "../responsible-gambling/rg.service.ts";
import { TeenPattiRepository } from "./teen-patti.repository.ts";
import { GameSettingsService } from "../game-settings/game-settings.service.ts";

export type TpRoomEvent =
  | { type: "table_state"; tableId: number; payload: unknown }
  | { type: "hand_started"; tableId: number; payload: unknown }
  | { type: "action_applied"; tableId: number; payload: unknown }
  | { type: "hand_ended"; tableId: number; payload: unknown }
  | { type: "error"; tableId: number; userId?: number; payload: { message: string } };

interface LiveTable {
  tableId: number;
  hand: TeenPattiHandState | null;
  dealerSeat: number;
  turnTimer?: ReturnType<typeof setTimeout>;
  turnEndsAt?: number | null;
  /** Players who already got stack credited back mid-hand. */
  walletReturned?: Set<number>;
}

@Injectable()
export class TeenPattiService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(TeenPattiService.name);
  private readonly live = new Map<number, LiveTable>();

  constructor(
    @Inject(TeenPattiRepository) private readonly repo: TeenPattiRepository,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(ResponsibleGamblingService) private readonly rg: ResponsibleGamblingService,
    /** Optional so services can still be built by hand (tests); Nest always injects it. */
    @Optional()
    @Inject(GameSettingsService)
    private readonly gameSettings?: GameSettingsService,
  ) {
    super();
    this.setMaxListeners(100);
  }

  async onModuleInit(): Promise<void> {
    await this.repo.ensureDefaultTable();
    await this.rehydrate();
  }

  private async rehydrate(): Promise<void> {
    const tables = await this.repo.listTables();
    for (const t of tables) {
      if (!this.live.has(t.id)) {
        this.live.set(t.id, { tableId: t.id, hand: null, dealerSeat: 0 });
      }
      const active = await this.repo.findActiveHand(t.id);
      if (active) {
        await this.forceEndHand(t.id, true);
      }
    }
  }

  private emitRoom(event: TpRoomEvent): void {
    this.emit("room", event);
  }

  private getLive(tableId: number): LiveTable {
    let live = this.live.get(tableId);
    if (!live) {
      live = { tableId, hand: null, dealerSeat: 0 };
      this.live.set(tableId, live);
    }
    return live;
  }

  private clearTurnTimer(live: LiveTable): void {
    if (live.turnTimer) {
      clearTimeout(live.turnTimer);
      live.turnTimer = undefined;
    }
    live.turnEndsAt = null;
  }

  private scheduleTurnTimeout(tableId: number): void {
    const live = this.getLive(tableId);
    this.clearTurnTimer(live);
    const hand = live.hand;
    if (!hand || hand.actingSeat === null) return;
    const acting = hand.players.find((p) => p.seatIndex === hand.actingSeat);
    if (!acting) return;

    live.turnEndsAt = Date.now() + TP_TURN_TIMEOUT_MS;
    live.turnTimer = setTimeout(() => {
      void this.handleTimeout(tableId, acting.userId);
    }, TP_TURN_TIMEOUT_MS);
  }

  private async handleTimeout(tableId: number, userId: number): Promise<void> {
    const live = this.getLive(tableId);
    if (!live.hand) return;
    const acting = live.hand.players.find((p) => p.userId === userId);
    if (!acting || live.hand.actingSeat !== acting.seatIndex) return;
    const autoAction = timeoutAction(live.hand, userId);
    try {
      await this.applyPlayerAction(tableId, userId, autoAction);
    } catch (err) {
      this.logger.warn(`Timeout action failed: ${String(err)}`);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async listTablesForUser() {
    const tables = await this.repo.listTables();
    const result = [];
    for (const t of tables) {
      if (t.status === TP_TABLE_STATUS.DISABLED) continue;
      const seats = await this.repo.listSeats(t.id, true);
      result.push({
        id: t.id,
        name: t.name,
        bootUsd: t.bootUsd,
        minBuyIn: t.minBuyIn,
        maxBuyIn: t.maxBuyIn,
        maxSeats: t.maxSeats,
        status: t.status,
        seatedCount: seats.length,
        seatsFree: Math.max(0, t.maxSeats - seats.length),
      });
    }
    return result;
  }

  async getTableDetail(tableId: number, viewerUserId?: number) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    return this.buildTableState(tableId, viewerUserId ?? null);
  }

  async buyIn(userId: number, tableId: number, dto: TpBuyInDto) {
    await this.rg.assertCanPlay(userId);
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    if (table.status !== TP_TABLE_STATUS.OPEN) {
      throw new BadRequestException("Table is not open for buy-in");
    }

    const wallet = await this.wallet.getBalance(userId);
    // Like color game: sit against wallet — reserve only when a hand starts.
    const amount = normalizeUsd(
      dto.amountUsd === undefined || dto.amountUsd === null
        ? wallet.balanceUsd
        : Math.min(Number(dto.amountUsd), Number(wallet.balanceUsd)),
    );
    if (Number(amount) < Number(table.minBuyIn)) {
      throw new BadRequestException(
        `Need at least ${table.minBuyIn} USD in wallet to sit (min buy-in)`,
      );
    }

    const existing = await this.repo.findSeatByUser(tableId, userId);
    if (existing && existing.status === TP_SEAT_STATUS.SEATED) {
      throw new BadRequestException("Already seated at this table");
    }

    const seats = await this.repo.listSeats(tableId, true);
    if (seats.length >= table.maxSeats) {
      throw new BadRequestException("Table is full");
    }

    let seatIndex = dto.seatIndex;
    if (seatIndex === undefined || seatIndex === null) {
      const taken = new Set(seats.map((s) => s.seatIndex));
      seatIndex = -1;
      for (let i = 0; i < table.maxSeats; i += 1) {
        if (!taken.has(i)) {
          seatIndex = i;
          break;
        }
      }
      if (seatIndex < 0) throw new BadRequestException("No free seats");
    } else {
      if (seatIndex < 0 || seatIndex >= table.maxSeats) {
        throw new BadRequestException("Invalid seat index");
      }
      if (seats.some((s) => s.seatIndex === seatIndex)) {
        throw new BadRequestException("Seat taken");
      }
    }

    await this.repo.clearLeftSeatsAt(tableId, seatIndex);
    if (existing && existing.status === TP_SEAT_STATUS.LEFT) {
      await this.repo.deleteSeat(existing.id);
    }

    await this.repo.createSeat({
      tableId,
      userId,
      seatIndex,
      stackUsd: amount,
    });

    await this.maybeStartHand(tableId);
    const state = await this.buildTableState(tableId, userId);
    this.emitRoom({ type: "table_state", tableId, payload: state });
    return state;
  }

  async cashOut(userId: number, tableId: number, force = false) {
    const live = this.getLive(tableId);
    if (live.hand) {
      const player = live.hand.players.find((p) => p.userId === userId);
      if (player && !player.packed) {
        if (!force) {
          throw new BadRequestException("Cannot cash out during an active hand");
        }
        if (live.hand.actingSeat === player.seatIndex) {
          try {
            await this.applyPlayerAction(tableId, userId, "pack");
          } catch {
            if (live.hand) {
              const p = live.hand.players.find((x) => x.userId === userId);
              if (p) p.packed = true;
            }
          }
        } else if (live.hand) {
          player.packed = true;
        }
      }

      // Pack-on-turn may have settled the hand already.
      if (live.hand) {
        const leaving = live.hand.players.find((p) => p.userId === userId);
        if (leaving && !(live.walletReturned?.has(userId))) {
          const handId = live.hand.handId;
          const remaining = normalizeUsd(leaving.stack);
          if (Number(remaining) > 0) {
            await this.wallet.creditFromCardHand({
              userId,
              amountUsd: remaining,
              game: "teen",
              handId,
              description: `Teen Patti leave mid-hand #${handId}`,
            });
          }
          leaving.stack = 0;
          live.walletReturned ??= new Set();
          live.walletReturned.add(userId);
        }
      }
    }

    const seat = await this.repo.findSeatByUser(tableId, userId);
    if (!seat || seat.status !== TP_SEAT_STATUS.SEATED) {
      if (force) {
        const state = await this.buildTableState(tableId, userId);
        return { cashOutUsd: "0", table: state };
      }
      throw new BadRequestException("Not seated at this table");
    }

    await this.repo.deleteSeat(seat.id);

    const state = await this.buildTableState(tableId, userId);
    this.emitRoom({ type: "table_state", tableId, payload: state });
    return { cashOutUsd: "0", table: state };
  }

  async maybeStartHand(tableId: number): Promise<void> {
    const table = await this.repo.findTable(tableId);
    if (!table || table.status !== TP_TABLE_STATUS.OPEN) return;
    // Game switched off by an admin: finish hands in progress, start no new ones.
    if (this.gameSettings && !(await this.gameSettings.isEnabled("teen-patti"))) return;

    const live = this.getLive(tableId);
    if (live.hand) return;

    const seats = await this.repo.listSeats(tableId, true);
    const funded: Array<{ userId: number; seatIndex: number; stack: number }> = [];
    for (const s of seats) {
      let bal = await this.wallet.getBalance(s.userId);
      const seatStack = Number(s.stackUsd);
      if (seatStack > Number(bal.balanceUsd) + 1e-8) {
        await this.wallet.creditTeenCashout({
          userId: s.userId,
          amountUsd: seatStack,
          seatId: s.id,
          description: `Teen Patti seat #${s.id} escrow → wallet`,
        });
        bal = await this.wallet.getBalance(s.userId);
      }
      const stack = Number(normalizeUsd(bal.balanceUsd));
      await this.repo.updateSeat(s.id, { stackUsd: normalizeUsd(stack) });
      if (stack >= Number(table.bootUsd) && stack > 0) {
        funded.push({ userId: s.userId, seatIndex: s.seatIndex, stack });
      }
    }
    if (funded.length < 2) return;

    const handNo = table.handCounter + 1;
    await this.repo.bumpHandCounter(tableId, handNo);

    const dealerCandidates = funded.map((s) => s.seatIndex).sort((a, b) => a - b);
    let dealerSeat = live.dealerSeat;
    const idx = dealerCandidates.indexOf(dealerSeat);
    dealerSeat =
      idx >= 0
        ? dealerCandidates[(idx + 1) % dealerCandidates.length]!
        : dealerCandidates[0]!;
    live.dealerSeat = dealerSeat;

    const handRow = await this.repo.createHand({ tableId, handNo });

    const reserved: Array<{ userId: number; amount: number }> = [];
    try {
      for (const s of funded) {
        await this.wallet.debitForCardHand({
          userId: s.userId,
          amountUsd: s.stack,
          game: "teen",
          handId: handRow.id,
        });
        reserved.push({ userId: s.userId, amount: s.stack });
      }
    } catch (err) {
      for (const r of reserved) {
        await this.wallet.creditFromCardHand({
          userId: r.userId,
          amountUsd: r.amount,
          game: "teen",
          handId: handRow.id,
          description: `Teen Patti hand #${handRow.id} reserve rollback`,
        });
      }
      await this.repo.updateHand(handRow.id, {
        status: TP_HAND_STATUS.CANCELLED,
        endedAt: new Date().toISOString(),
      });
      this.logger.warn(`Teen Patti hand reserve failed: ${String(err)}`);
      return;
    }

    const engineState = startHand({
      handId: handRow.id,
      handNo,
      boot: Number(table.bootUsd),
      seats: funded.map((s) => ({
        userId: s.userId,
        seatIndex: s.seatIndex,
        stack: s.stack,
      })),
      dealerSeat,
    });

    live.walletReturned = new Set();

    for (const p of engineState.players) {
      await this.syncSeatStack(tableId, p.userId, p.stack);
    }

    live.hand = engineState;

    this.emitRoom({
      type: "hand_started",
      tableId,
      payload: { handId: handRow.id, handNo },
    });
    this.scheduleTurnTimeout(tableId);
    this.broadcastTableState(tableId);
  }

  async applyPlayerAction(
    tableId: number,
    userId: number,
    action: TeenPattiActionType,
  ) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    if (table.status === TP_TABLE_STATUS.FROZEN) {
      throw new BadRequestException("Table is frozen");
    }

    const live = this.getLive(tableId);
    if (!live.hand) throw new BadRequestException("No active hand");

    const result = applyAction(live.hand, userId, action);
    if (!result.ok) throw new BadRequestException(result.error);

    live.hand = result.state;

    this.emitRoom({
      type: "action_applied",
      tableId,
      payload: { userId, action },
    });

    if (result.handOver && result.result) {
      await this.settleHand(tableId, result.result);
      return;
    }

    this.scheduleTurnTimeout(tableId);
    this.broadcastTableState(tableId);
  }

  private async settleHand(tableId: number, result: TeenPattiHandResult): Promise<void> {
    const live = this.getLive(tableId);
    const hand = live.hand;
    if (!hand) return;
    // Detach immediately so a racing timeout/action cannot settle twice.
    live.hand = null;
    this.clearTurnTimer(live);

    const returned = live.walletReturned ?? new Set<number>();
    for (const p of hand.players) {
      if (!returned.has(p.userId) && p.stack > 0) {
        await this.wallet.creditFromCardHand({
          userId: p.userId,
          amountUsd: p.stack,
          game: "teen",
          handId: hand.handId,
        });
      }
      const bal = await this.wallet.getBalance(p.userId);
      await this.syncSeatStack(tableId, p.userId, Number(bal.balanceUsd));
    }

    const winnerUserId = result.winners[0]?.userId ?? null;
    await this.repo.updateHand(hand.handId, {
      status: TP_HAND_STATUS.COMPLETED,
      potUsd: normalizeUsd(result.pot),
      winnerUserId,
      endedAt: new Date().toISOString(),
    });

    live.hand = null;
    live.walletReturned = undefined;

    this.emitRoom({
      type: "hand_ended",
      tableId,
      payload: {
        handId: hand.handId,
        winners: result.winners,
        pot: result.pot,
        reveals: result.reveals,
      },
    });
    this.broadcastTableState(tableId);

    setTimeout(() => {
      void this.maybeStartHand(tableId);
    }, 1500);
  }

  private async syncSeatStack(tableId: number, userId: number, stack: number) {
    const seat = await this.repo.findSeatByUser(tableId, userId);
    if (seat) {
      await this.repo.updateSeat(seat.id, { stackUsd: normalizeUsd(stack) });
    }
  }

  async broadcastTableState(tableId: number): Promise<void> {
    this.emitRoom({ type: "table_state", tableId, payload: { refresh: true } });
  }

  async buildTableState(tableId: number, viewerUserId: number | null) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    const seats = await this.repo.listSeats(tableId, true);
    const live = this.getLive(tableId);
    const hand = live.hand;
    const handOver = false; // hand is removed from live when over

    const seatViews = seats.map((s) => {
      const hp = hand?.players.find((p) => p.userId === s.userId);
      const isSelf = viewerUserId != null && s.userId === viewerUserId;
      return {
        seatIndex: s.seatIndex,
        userId: s.userId,
        // Never expose another player's wallet/stack balance.
        stackUsd: isSelf
          ? hp
            ? normalizeUsd(hp.stack)
            : s.stackUsd
          : null,
        status: s.status,
        hasSeen: hp?.hasSeen ?? false,
        packed: hp?.packed ?? false,
        totalBet: hp?.totalBet ?? 0,
        cards: hp
          ? publicPlayerView(hp, viewerUserId, handOver).cards
          : null,
      };
    });

    const legal =
      hand && viewerUserId ? legalActions(hand, viewerUserId) : null;

    return {
      id: table.id,
      name: table.name,
      bootUsd: table.bootUsd,
      minBuyIn: table.minBuyIn,
      maxBuyIn: table.maxBuyIn,
      maxSeats: table.maxSeats,
      status: table.status,
      seats: seatViews,
      hand: hand
        ? {
            handId: hand.handId,
            handNo: hand.handNo,
            boot: hand.boot,
            currentStake: hand.currentStake,
            pot: hand.pot,
            actingSeat: hand.actingSeat,
            legal,
            turnEndsAt: live.turnEndsAt
              ? new Date(live.turnEndsAt).toISOString()
              : null,
            turnTimeoutMs: TP_TURN_TIMEOUT_MS,
            serverNow: new Date().toISOString(),
          }
        : null,
    };
  }

  // ── Admin API ──────────────────────────────────────────────────────────────

  async adminListTables() {
    const tables = await this.repo.listTables();
    const out = [];
    for (const t of tables) {
      const seats = await this.repo.listSeats(t.id, true);
      const live = this.getLive(t.id);
      out.push({
        ...t,
        seatedCount: seats.length,
        activeHandId: live.hand?.handId ?? null,
      });
    }
    return out;
  }

  async adminCreateTable(dto: CreateTpTableDto) {
    const row = await this.repo.createTable({
      name: dto.name,
      bootUsd: normalizeUsd(dto.bootUsd),
      minBuyIn: normalizeUsd(dto.minBuyIn),
      maxBuyIn: normalizeUsd(dto.maxBuyIn),
      maxSeats: dto.maxSeats ?? 5,
    });
    this.getLive(row.id);
    return row;
  }

  async adminUpdateTable(id: number, dto: UpdateTpTableDto) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    const data: Record<string, string | number> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.bootUsd !== undefined) data.bootUsd = normalizeUsd(dto.bootUsd);
    if (dto.minBuyIn !== undefined) data.minBuyIn = normalizeUsd(dto.minBuyIn);
    if (dto.maxBuyIn !== undefined) data.maxBuyIn = normalizeUsd(dto.maxBuyIn);
    if (dto.maxSeats !== undefined) data.maxSeats = dto.maxSeats;
    if (dto.status !== undefined) data.status = dto.status;
    return this.repo.updateTable(id, data);
  }

  async freezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    return this.repo.updateTable(id, { status: TP_TABLE_STATUS.FROZEN });
  }

  async unfreezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    const updated = await this.repo.updateTable(id, { status: TP_TABLE_STATUS.OPEN });
    await this.maybeStartHand(id);
    return updated;
  }

  async forceEndHand(tableId: number, quiet = false) {
    const live = this.getLive(tableId);
    const hand = live.hand;
    const activeDb = await this.repo.findActiveHand(tableId);

    if (!hand && !activeDb) {
      if (quiet) return { ok: true };
      throw new BadRequestException("No active hand");
    }

    this.clearTurnTimer(live);

    if (hand) {
      // Refund pot proportionally to contributors
      const totalContrib = hand.players.reduce((s, p) => s + p.totalBet, 0);
      const returned = live.walletReturned ?? new Set<number>();
      for (const p of hand.players) {
        const refund = totalContrib > 0 ? (p.totalBet / totalContrib) * hand.pot : 0;
        const ending = p.stack + refund;
        if (returned.has(p.userId)) {
          if (refund > 0) {
            await this.wallet.creditFromCardHand({
              userId: p.userId,
              amountUsd: refund,
              game: "teen",
              handId: hand.handId,
              description: `Teen Patti hand #${hand.handId} force-end pot refund`,
            });
          }
        } else if (ending > 0) {
          await this.wallet.creditFromCardHand({
            userId: p.userId,
            amountUsd: ending,
            game: "teen",
            handId: hand.handId,
            description: `Teen Patti hand #${hand.handId} force-end refund`,
          });
        }
        const bal = await this.wallet.getBalance(p.userId);
        await this.syncSeatStack(tableId, p.userId, Number(bal.balanceUsd));
      }

      await this.repo.updateHand(hand.handId, {
        status: TP_HAND_STATUS.CANCELLED,
        potUsd: normalizeUsd(hand.pot),
        endedAt: new Date().toISOString(),
      });
      live.hand = null;
      live.walletReturned = undefined;
    } else if (activeDb) {
      await this.wallet.refundOutstandingCardHand({
        game: "teen",
        handId: activeDb.id,
      });
      const seats = await this.repo.listSeats(tableId, true);
      for (const s of seats) {
        const bal = await this.wallet.getBalance(s.userId);
        await this.syncSeatStack(tableId, s.userId, Number(bal.balanceUsd));
      }
      await this.repo.updateHand(activeDb.id, {
        status: TP_HAND_STATUS.CANCELLED,
        endedAt: new Date().toISOString(),
      });
    }

    this.broadcastTableState(tableId);
    return { ok: true };
  }

  async adminListHands(tableId?: number, limit = 50) {
    return this.repo.listHands({ tableId, limit });
  }

  async adminOverview() {
    const tables = await this.repo.listTables();
    const open = tables.filter((t) => t.status === TP_TABLE_STATUS.OPEN).length;
    const activeHands = await this.repo.countActiveHands();
    const hands = await this.repo.listHands({ limit: 5000 });
    let totalVolume = "0";
    for (const h of hands) {
      totalVolume = String(
        Math.round((Number(totalVolume) + Number(h.potUsd)) * 100) / 100,
      );
    }
    let liveActive = 0;
    for (const l of this.live.values()) {
      if (l.hand) liveActive += 1;
    }
    return {
      tablesOpen: open,
      tablesTotal: tables.length,
      activeHands: Math.max(activeHands, liveActive),
      totalVolume,
    };
  }
}
