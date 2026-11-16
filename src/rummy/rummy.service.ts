import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { EventEmitter } from "node:events";

import { normalizeUsd } from "../wallet/wallet.math.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import type {
  CreateRummyTableDto,
  RummyActionDto,
  UpdateRummyTableDto,
} from "./dto/rummy.dto.ts";
import {
  applyAction,
  applyTimeoutSkip,
  publicPlayerView,
  resolveIfHandShouldEnd,
  startHand,
  type RummyHandResult,
  type RummyHandState,
} from "./rummy.engine.ts";
import {
  RUMMY_HAND_STATUS,
  RUMMY_MAX_POINTS,
  RUMMY_SEAT_STATUS,
  RUMMY_TABLE_STATUS,
  RUMMY_TURN_TIMEOUT_MS,
} from "./rummy.constants.ts";
import { RummyRepository } from "./rummy.repository.ts";

export type RummyRoomEvent =
  | { type: "table_state"; tableId: number; payload: unknown }
  | { type: "hand_started"; tableId: number; payload: unknown }
  | { type: "action_applied"; tableId: number; payload: unknown }
  | { type: "hand_ended"; tableId: number; payload: unknown }
  | { type: "error"; tableId: number; userId?: number; payload: { message: string } };

interface LiveTable {
  tableId: number;
  hand: RummyHandState | null;
  turnTimer?: ReturnType<typeof setTimeout>;
  turnEndsAt?: number | null;
  /** Seat whose turn the current timer belongs to (draw must not reset). */
  timedActingSeat?: number | null;
  /** Players who already got stack credited back mid-hand. */
  walletReturned?: Set<number>;
}

@Injectable()
export class RummyService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(RummyService.name);
  private readonly live = new Map<number, LiveTable>();

  constructor(
    @Inject(RummyRepository) private readonly repo: RummyRepository,
    @Inject(WalletService) private readonly wallet: WalletService,
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
        this.live.set(t.id, { tableId: t.id, hand: null });
      }
      const active = await this.repo.findActiveHand(t.id);
      if (active) {
        await this.cancelOrphanedHand(t.id, active.id);
      }
    }
  }

  private emitRoom(event: RummyRoomEvent): void {
    this.emit("room", event);
  }

  private getLive(tableId: number): LiveTable {
    let live = this.live.get(tableId);
    if (!live) {
      live = { tableId, hand: null };
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
    live.timedActingSeat = null;
  }

  /**
   * Start/refresh the turn timer. Rummy turns include draw + discard for the
   * same seat — do not reset the clock on draw (only when the actor changes).
   */
  private scheduleTurnTimeout(
    tableId: number,
    opts: { force?: boolean } = {},
  ): void {
    const live = this.getLive(tableId);
    const hand = live.hand;
    if (!hand || hand.phase !== "playing") {
      this.clearTurnTimer(live);
      return;
    }

    // Acting seat empty / already dropped → advance or end the hand.
    let acting = hand.players.find((p) => p.seatIndex === hand.actingSeat);
    if (!acting || acting.dropped || acting.declaredValid) {
      const ended = resolveIfHandShouldEnd(hand);
      if (ended?.handOver && ended.result) {
        void this.settleHand(tableId, ended.result);
        return;
      }
      const next = hand.turnOrder.find((si) => {
        const p = hand.players.find((x) => x.seatIndex === si);
        return p && !p.dropped && !p.declaredValid;
      });
      hand.actingSeat = next ?? null;
      acting = hand.players.find((p) => p.seatIndex === hand.actingSeat);
      if (!acting) {
        const forced = resolveIfHandShouldEnd(hand);
        if (forced?.handOver && forced.result) {
          void this.settleHand(tableId, forced.result);
        }
        return;
      }
      opts = { force: true };
    }

    const sameTurn =
      !opts.force &&
      live.turnEndsAt != null &&
      live.turnEndsAt > Date.now() &&
      live.timedActingSeat === hand.actingSeat &&
      live.turnTimer != null;

    if (sameTurn) {
      return;
    }

    this.clearTurnTimer(live);
    live.timedActingSeat = hand.actingSeat;
    live.turnEndsAt = Date.now() + RUMMY_TURN_TIMEOUT_MS;
    const userId = acting.userId;
    live.turnTimer = setTimeout(() => {
      void this.handleTimeout(tableId, userId);
    }, RUMMY_TURN_TIMEOUT_MS);
  }

  private async handleTimeout(tableId: number, userId: number): Promise<void> {
    const live = this.getLive(tableId);
    if (!live.hand) return;
    const acting = live.hand.players.find((p) => p.userId === userId);
    if (!acting || live.hand.actingSeat !== acting.seatIndex) return;

    const actorBefore = live.hand.actingSeat;
    let result = applyTimeoutSkip(live.hand, userId);
    if (!result.ok) {
      this.logger.warn(
        `Rummy timeout skip failed (${result.error}) — forcing drop`,
      );
      result = applyAction(live.hand, userId, { type: "drop" });
      if (!result.ok) {
        this.logger.warn(`Rummy timeout drop also failed: ${result.error}`);
        this.scheduleTurnTimeout(tableId, { force: true });
        return;
      }
    }

    live.hand = result.state;
    this.emitRoom({
      type: "action_applied",
      tableId,
      payload: { userId, type: "timeout_skip" },
    });

    if (result.handOver && result.result) {
      await this.settleHand(tableId, result.result);
      return;
    }

    const ended = resolveIfHandShouldEnd(live.hand);
    if (ended?.handOver && ended.result) {
      live.hand = ended.state;
      await this.settleHand(tableId, ended.result);
      return;
    }

    const actorChanged = live.hand.actingSeat !== actorBefore;
    this.scheduleTurnTimeout(tableId, { force: actorChanged });
    this.broadcastTableState(tableId);
  }

  // ── User-facing table listing ──────────────────────────────────────────────

  async listTablesForUser() {
    const tables = await this.repo.listTables();
    const result = [];
    for (const t of tables) {
      if (t.status === RUMMY_TABLE_STATUS.DISABLED) continue;
      const seats = await this.repo.listSeats(t.id, true);
      result.push({
        id: t.id,
        name: t.name,
        pointValue: t.pointValue,
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
    if (!table) throw new NotFoundException("Rummy table not found");
    return this.buildTableState(tableId, viewerUserId ?? null);
  }

  // ── Buy-in / cash-out ──────────────────────────────────────────────────────

  async buyIn(
    userId: number,
    tableId: number,
    dto: { amountUsd?: number; seatIndex?: number },
  ) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Rummy table not found");
    if (table.status !== RUMMY_TABLE_STATUS.OPEN) {
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
    if (existing && existing.status === RUMMY_SEAT_STATUS.SEATED) {
      throw new BadRequestException("Already seated at this table");
    }

    const seats = await this.repo.listSeats(tableId, true);
    if (seats.length >= table.maxSeats) {
      throw new BadRequestException("Table is full");
    }

    // Find free seat
    let seatIndex = dto.seatIndex;
    if (seatIndex === undefined || seatIndex === null) {
      const taken = new Set(seats.map((s) => s.seatIndex));
      seatIndex = -1;
      for (let i = 0; i < table.maxSeats; i += 1) {
        if (!taken.has(i)) { seatIndex = i; break; }
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
    if (existing && existing.status === RUMMY_SEAT_STATUS.LEFT) {
      await this.repo.deleteSeat(existing.id);
    }

    await this.repo.createSeat({ tableId, userId, seatIndex, stackUsd: amount });

    await this.maybeStartHand(tableId);
    const state = await this.buildTableState(tableId, userId);
    this.emitRoom({ type: "table_state", tableId, payload: state });
    return state;
  }

  async cashOut(userId: number, tableId: number, force = false) {
    const live = this.getLive(tableId);
    let pendingSettle: RummyHandResult | null = null;

    if (live.hand && live.hand.phase === "playing") {
      const player = live.hand.players.find((p) => p.userId === userId);
      if (player && !player.dropped && !player.declaredValid) {
        if (!force) {
          throw new BadRequestException("Cannot cash out during an active hand");
        }
        player.dropped = true;
        player.dropPenalty = player.drew ? 40 : 20;
        player.finalPoints = player.dropPenalty;
        const ended = resolveIfHandShouldEnd(live.hand);
        if (ended?.handOver && ended.result) {
          pendingSettle = ended.result;
        } else if (live.hand.actingSeat === player.seatIndex) {
          this.scheduleTurnTimeout(tableId, { force: true });
        }
      }
    }

    // If leaving ends the hand, settle first (credits wallets), then remove seat.
    if (pendingSettle) {
      await this.settleHand(tableId, pendingSettle);
    } else if (live.hand) {
      const leaving = live.hand.players.find((p) => p.userId === userId);
      if (leaving && !(live.walletReturned?.has(userId))) {
        const handId = live.hand.handId;
        // Keep drop liability reserved so the eventual winner can be paid
        // without minting funds (finishHand still charges this seat's penalty).
        const liability =
          (leaving.dropPenalty || leaving.finalPoints || 0) *
          Number(live.hand.pointValue);
        const toReturn = Math.max(0, leaving.stack - liability);
        if (toReturn > 0) {
          await this.wallet.creditFromCardHand({
            userId,
            amountUsd: toReturn,
            game: "rummy",
            handId,
            description: `Rummy leave mid-hand #${handId}`,
          });
        }
        // Leave liability on the engine stack so settle can transfer it.
        leaving.stack = Math.min(leaving.stack, liability);
        live.walletReturned ??= new Set();
        live.walletReturned.add(userId);
      }
    }

    const seat = await this.repo.findSeatByUser(tableId, userId);
    if (!seat || seat.status !== RUMMY_SEAT_STATUS.SEATED) {
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

  // ── Hand lifecycle ─────────────────────────────────────────────────────────

  async maybeStartHand(tableId: number): Promise<void> {
    const table = await this.repo.findTable(tableId);
    if (!table || table.status !== RUMMY_TABLE_STATUS.OPEN) return;

    const live = this.getLive(tableId);
    if (live.hand) return;

    const seats = await this.repo.listSeats(tableId, true);
    const funded: Array<{ userId: number; seatIndex: number; stack: number }> = [];
    for (const s of seats) {
      let bal = await this.wallet.getBalance(s.userId);
      const seatStack = Number(s.stackUsd);
      if (seatStack > Number(bal.balanceUsd) + 1e-8) {
        await this.wallet.creditRummyCashout({
          userId: s.userId,
          amountUsd: seatStack,
          seatId: s.id,
          description: `Rummy seat #${s.id} escrow → wallet`,
        });
        bal = await this.wallet.getBalance(s.userId);
      }
      const stack = Number(normalizeUsd(bal.balanceUsd));
      await this.repo.updateSeat(s.id, { stackUsd: normalizeUsd(stack) });
      if (stack >= Number(table.minBuyIn) && stack > 0) {
        funded.push({ userId: s.userId, seatIndex: s.seatIndex, stack });
      }
    }
    if (funded.length < 2) return;

    const handNo = table.handCounter + 1;
    await this.repo.bumpHandCounter(tableId, handNo);

    const handRow = await this.repo.createHand({ tableId, handNo });

    const reserved: Array<{ userId: number; amount: number }> = [];
    try {
      for (const s of funded) {
        await this.wallet.debitForCardHand({
          userId: s.userId,
          amountUsd: s.stack,
          game: "rummy",
          handId: handRow.id,
        });
        reserved.push({ userId: s.userId, amount: s.stack });
      }
    } catch (err) {
      for (const r of reserved) {
        await this.wallet.creditFromCardHand({
          userId: r.userId,
          amountUsd: r.amount,
          game: "rummy",
          handId: handRow.id,
          description: `Rummy hand #${handRow.id} reserve rollback`,
        });
      }
      await this.repo.updateHand(handRow.id, {
        status: RUMMY_HAND_STATUS.CANCELLED,
        endedAt: new Date().toISOString(),
      });
      this.logger.warn(`Rummy hand reserve failed: ${String(err)}`);
      return;
    }

    const engineState = startHand({
      handId: handRow.id,
      handNo,
      seats: funded.map((s) => ({
        userId: s.userId,
        seatIndex: s.seatIndex,
        stack: s.stack,
      })),
      pointValue: Number(table.pointValue),
    });

    live.walletReturned = new Set();

    for (const p of engineState.players) {
      await this.syncSeatStack(tableId, p.userId, p.stack);
    }

    live.hand = engineState;
    this.emitRoom({
      type: "hand_started",
      tableId,
      payload: { handId: handRow.id, handNo, maxPoints: RUMMY_MAX_POINTS },
    });
    this.scheduleTurnTimeout(tableId, { force: true });
    this.broadcastTableState(tableId);
  }

  async applyPlayerAction(
    tableId: number,
    userId: number,
    actionDto: RummyActionDto | { type: "drop" },
  ) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Rummy table not found");
    if (table.status === RUMMY_TABLE_STATUS.FROZEN) {
      throw new BadRequestException("Table is frozen");
    }

    const live = this.getLive(tableId);
    if (!live.hand) throw new BadRequestException("No active hand");

    const actorBefore = live.hand.actingSeat;
    const result = applyAction(live.hand, userId, actionDto);
    if (!result.ok) throw new BadRequestException(result.error);

    live.hand = result.state;

    this.emitRoom({
      type: "action_applied",
      tableId,
      payload: { userId, type: actionDto.type },
    });

    if (result.handOver && result.result) {
      await this.settleHand(tableId, result.result);
      return;
    }

    // Safety net: 0–1 active players must end even if an action forgot to.
    const ended = resolveIfHandShouldEnd(live.hand);
    if (ended?.handOver && ended.result) {
      live.hand = ended.state;
      await this.settleHand(tableId, ended.result);
      return;
    }

    const actorChanged = live.hand.actingSeat !== actorBefore;
    this.scheduleTurnTimeout(tableId, { force: actorChanged });
    this.broadcastTableState(tableId);
  }

  private async settleHand(tableId: number, result: RummyHandResult): Promise<void> {
    const live = this.getLive(tableId);
    const hand = live.hand;
    if (!hand) return;
    // Detach immediately so a racing timeout/action cannot settle twice.
    live.hand = null;
    this.clearTurnTimer(live);

    const returned = live.walletReturned ?? new Set<number>();
    for (const p of hand.players) {
      // Mid-hand leavers already received stack − drop liability; only credit
      // whatever finishHand left on their stack (normally 0).
      if (p.stack > 0) {
        await this.wallet.creditFromCardHand({
          userId: p.userId,
          amountUsd: p.stack,
          game: "rummy",
          handId: hand.handId,
          description: returned.has(p.userId)
            ? `Rummy hand #${hand.handId} leftover after leave`
            : undefined,
        });
      }
      const bal = await this.wallet.getBalance(p.userId);
      await this.syncSeatStack(tableId, p.userId, Number(bal.balanceUsd));
    }

    await this.repo.updateHand(hand.handId, {
      status: RUMMY_HAND_STATUS.COMPLETED,
      winnerUserId: result.winnerId,
      endedAt: new Date().toISOString(),
    });

    live.hand = null;
    live.walletReturned = undefined;
    this.emitRoom({
      type: "hand_ended",
      tableId,
      payload: { handId: hand.handId, ...result },
    });
    this.broadcastTableState(tableId);

    setTimeout(() => { void this.maybeStartHand(tableId); }, 2000);
  }

  private async cancelOrphanedHand(tableId: number, handId: number): Promise<void> {
    await this.wallet.refundOutstandingCardHand({
      game: "rummy",
      handId,
    });
    const seats = await this.repo.listSeats(tableId, true);
    for (const s of seats) {
      const bal = await this.wallet.getBalance(s.userId);
      await this.syncSeatStack(tableId, s.userId, Number(bal.balanceUsd));
    }
    await this.repo.updateHand(handId, {
      status: RUMMY_HAND_STATUS.CANCELLED,
      endedAt: new Date().toISOString(),
    });
    this.logger.warn(`Cancelled orphaned rummy hand ${handId} on table ${tableId}`);
  }

  private async syncSeatStack(tableId: number, userId: number, stack: number): Promise<void> {
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
    if (!table) throw new NotFoundException("Rummy table not found");
    const seats = await this.repo.listSeats(tableId, true);
    const live = this.getLive(tableId);
    const hand = live.hand;
    const handOver = hand?.phase === "ended";

    const seatViews = seats.map((s) => {
      const hp = hand?.players.find((p) => p.userId === s.userId);
      const isSelf = viewerUserId != null && s.userId === viewerUserId;
      const pub = hp ? publicPlayerView(hp, viewerUserId, !!handOver) : null;
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
        ...(pub
          ? {
              ...pub,
              stack: isSelf ? pub.stack : null,
            }
          : {}),
      };
    });

    return {
      id: table.id,
      name: table.name,
      pointValue: table.pointValue,
      minBuyIn: table.minBuyIn,
      maxBuyIn: table.maxBuyIn,
      maxSeats: table.maxSeats,
      status: table.status,
      seats: seatViews,
      hand: hand
        ? {
            handId: hand.handId,
            handNo: hand.handNo,
            phase: hand.phase,
            closedDeckSize: hand.closedDeck.length,
            discardTop: hand.discardPile[hand.discardPile.length - 1] ?? null,
            actingSeat: hand.actingSeat,
            winnerId: hand.winnerId,
            turnEndsAt: live.turnEndsAt
              ? new Date(live.turnEndsAt).toISOString()
              : null,
            turnTimeoutMs: RUMMY_TURN_TIMEOUT_MS,
            serverNow: new Date().toISOString(),
          }
        : null,
    };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

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

  async adminCreateTable(dto: CreateRummyTableDto) {
    const row = await this.repo.createTable({
      name: dto.name,
      pointValue: normalizeUsd(dto.pointValue),
      minBuyIn: normalizeUsd(dto.minBuyIn),
      maxBuyIn: normalizeUsd(dto.maxBuyIn),
      maxSeats: dto.maxSeats ?? 4,
    });
    this.getLive(row.id);
    return row;
  }

  async adminUpdateTable(id: number, dto: UpdateRummyTableDto) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Rummy table not found");
    const data: Record<string, string | number> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.pointValue !== undefined) data.pointValue = normalizeUsd(dto.pointValue);
    if (dto.minBuyIn !== undefined) data.minBuyIn = normalizeUsd(dto.minBuyIn);
    if (dto.maxBuyIn !== undefined) data.maxBuyIn = normalizeUsd(dto.maxBuyIn);
    if (dto.maxSeats !== undefined) data.maxSeats = dto.maxSeats;
    if (dto.status !== undefined) data.status = dto.status;
    return this.repo.updateTable(id, data);
  }

  async freezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Rummy table not found");
    return this.repo.updateTable(id, { status: RUMMY_TABLE_STATUS.FROZEN });
  }

  async unfreezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Rummy table not found");
    const updated = await this.repo.updateTable(id, { status: RUMMY_TABLE_STATUS.OPEN });
    await this.maybeStartHand(id);
    return updated;
  }

  async forceEndHand(tableId: number, quiet = false) {
    const live = this.getLive(tableId);
    const hand = live.hand;
    const activeDb = await this.repo.findActiveHand(tableId);

    if (!hand && !activeDb) {
      if (quiet) return { ok: true };
      throw new BadRequestException("No active rummy hand");
    }

    this.clearTurnTimer(live);

    const handId = hand?.handId ?? activeDb?.id;
    if (handId != null) {
      // Covers mid-leave partial credits — only outstanding reserve is refunded.
      await this.wallet.refundOutstandingCardHand({
        game: "rummy",
        handId,
      });
      const seats = await this.repo.listSeats(tableId, true);
      for (const s of seats) {
        const bal = await this.wallet.getBalance(s.userId);
        await this.syncSeatStack(tableId, s.userId, Number(bal.balanceUsd));
      }
      await this.repo.updateHand(handId, {
        status: RUMMY_HAND_STATUS.CANCELLED,
        endedAt: new Date().toISOString(),
      });
    }
    live.hand = null;
    live.walletReturned = undefined;

    this.broadcastTableState(tableId);
    return { ok: true };
  }

  async adminListHands(tableId?: number, limit = 50) {
    return this.repo.listHands({ tableId, limit });
  }

  async adminOverview() {
    const tables = await this.repo.listTables();
    const open = tables.filter((t) => t.status === RUMMY_TABLE_STATUS.OPEN).length;
    let liveActive = 0;
    for (const l of this.live.values()) {
      if (l.hand) liveActive += 1;
    }
    return {
      tablesOpen: open,
      tablesTotal: tables.length,
      activeHands: liveActive,
    };
  }
}
