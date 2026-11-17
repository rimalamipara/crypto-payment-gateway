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

import { addUsd, normalizeUsd } from "../wallet/wallet.math.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import type {
  BuyInDto,
  CreatePokerTableDto,
  JoinStakeDto,
  UpdatePokerTableDto,
} from "./dto/poker.dto.ts";
import {
  POKER_STAKE_TEMPLATES,
  sameStakes,
  stakeBaseName,
} from "./poker.stakes.ts";
import {
  applyAction,
  forceFold,
  legalActions,
  type HandResult,
  type PokerActionType,
  publicPlayerView,
  startHand,
  type TableHandState,
  timeoutAction,
} from "./poker.engine.ts";
import {
  POKER_HAND_STATUS,
  POKER_SEAT_STATUS,
  POKER_TABLE_STATUS,
  TURN_TIMEOUT_MS,
} from "./poker.constants.ts";
import { PokerRepository } from "./poker.repository.ts";
import { GameSettingsService } from "../game-settings/game-settings.service.ts";

/** PostgreSQL unique_violation — do not match on index name (can drift). */
function isPgUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur; i += 1) {
    if (
      typeof cur === "object" &&
      cur !== null &&
      "code" in cur &&
      (cur as { code?: string }).code === "23505"
    ) {
      return true;
    }
    if (
      typeof cur === "object" &&
      cur !== null &&
      "cause" in cur
    ) {
      cur = (cur as { cause: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

export type PokerRoomEvent =
  | { type: "table_state"; tableId: number; payload: unknown }
  | { type: "hand_started"; tableId: number; payload: unknown }
  | { type: "action_applied"; tableId: number; payload: unknown }
  | { type: "hand_ended"; tableId: number; payload: unknown }
  | { type: "error"; tableId: number; userId?: number; payload: { message: string } };

interface LiveTable {
  tableId: number;
  hand: TableHandState | null;
  dealerSeat: number;
  turnTimer?: ReturnType<typeof setTimeout>;
  /** Post-settle delay before maybeStartHand; must be cleared on force-end/freeze. */
  restartTimer?: ReturnType<typeof setTimeout>;
  /** Epoch ms when the current actor's turn expires. */
  turnEndsAt?: number | null;
  /** Players who already got their stack credited back mid-hand (left table). */
  walletReturned?: Set<number>;
  /**
   * All-in players who force-left: seat kept as sitting_out until settleHand
   * credits the wallet and deletes the seat (spec 10.7).
   */
  allInLeftUserIds?: Set<number>;
}

@Injectable()
export class PokerService extends EventEmitter implements OnModuleInit {
  private readonly logger = new Logger(PokerService.name);
  private readonly live = new Map<number, LiveTable>();
  /** Single-instance orphan sweep: only hands that predate this boot. */
  private readonly processStartedAt = new Date();
  private orphanSweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PokerRepository) private readonly repo: PokerRepository,
    @Inject(WalletService) private readonly wallet: WalletService,
    /** Optional so services can still be built by hand (tests); Nest always injects it. */
    @Optional()
    @Inject(GameSettingsService)
    private readonly gameSettings?: GameSettingsService,
  ) {
    super();
    this.setMaxListeners(100);
  }

  async onModuleInit(): Promise<void> {
    await this.repo.ensureStakeTables(POKER_STAKE_TEMPLATES);
    await this.rehydrate();
    this.orphanSweepTimer = setInterval(() => {
      void this.sweepOrphanHands();
    }, 60_000);
  }

  private async rehydrate(): Promise<void> {
    const tables = await this.repo.listTables();
    for (const t of tables) {
      if (!this.live.has(t.id)) {
        this.live.set(t.id, {
          tableId: t.id,
          hand: null,
          dealerSeat: 0,
        });
      }
      try {
        const settling = await this.repo.findHandByTableStatus(
          t.id,
          POKER_HAND_STATUS.SETTLING,
        );
        if (settling) {
          await this.finishSettlingFromDb(t.id, settling.id);
          continue;
        }
        const cancelling = await this.repo.findHandByTableStatus(
          t.id,
          POKER_HAND_STATUS.CANCELLING,
        );
        if (cancelling) {
          await this.finishCancellingFromDb(t.id, cancelling.id);
          continue;
        }
        const active = await this.repo.findActiveHand(t.id);
        if (active) {
          // Cancel orphaned in-DB active hands on restart (in-memory state lost)
          await this.forceEndHand(t.id, true);
        }
      } catch (err) {
        this.logger.error(
          `rehydrate failed for table ${t.id}: ${String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  /**
   * Orphan sweep: hands not held in this process's memory that started before
   * boot. Uses pg_try_advisory_xact_lock inside one interactive transaction
   * together with active→cancelling claims so the lock cannot leak across a
   * pooled connection (session locks are unsafe with Prisma/pg pools).
   */
  private async sweepOrphanHands(): Promise<void> {
    try {
      const skipHandIds = new Set<number>();
      for (const live of this.live.values()) {
        if (live.hand) skipHandIds.add(live.hand.handId);
      }

      const claim = await this.repo.tryOrphanSweepClaims({
        beforeIso: this.processStartedAt.toISOString(),
        skipHandIds,
      });
      if (!claim.acquired) return; // another instance holds the xact lock

      const byId = new Map(
        (await this.repo.listOrphanHandCandidates(
          this.processStartedAt.toISOString(),
        )).map((h) => [h.id, h]),
      );

      const workIds = [
        ...claim.settlingIds,
        ...claim.claimedActiveIds,
        ...claim.alreadyCancellingIds,
      ];
      for (const handId of workIds) {
        const hand = byId.get(handId) ?? (await this.repo.findHand(handId));
        if (!hand) continue;
        try {
          if (hand.status === POKER_HAND_STATUS.SETTLING) {
            await this.finishSettlingFromDb(hand.tableId, hand.id);
          } else {
            await this.forceEndHand(hand.tableId, true);
          }
        } catch (err) {
          this.logger.error(
            `orphan sweep failed table=${hand.tableId} hand=${hand.id}: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `orphan sweep tick failed: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private emitRoom(event: PokerRoomEvent): void {
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

  private clearRestartTimer(live: LiveTable): void {
    if (live.restartTimer) {
      clearTimeout(live.restartTimer);
      live.restartTimer = undefined;
    }
  }

  private scheduleTurnTimeout(tableId: number): void {
    const live = this.getLive(tableId);
    this.clearTurnTimer(live);
    const hand = live.hand;
    if (!hand || hand.actingSeat === null) return;
    const acting = hand.players.find((p) => p.seatIndex === hand.actingSeat);
    if (!acting) return;

    live.turnEndsAt = Date.now() + TURN_TIMEOUT_MS;
    live.turnTimer = setTimeout(() => {
      void this.handleTimeout(tableId, acting.userId);
    }, TURN_TIMEOUT_MS);
  }

  private async handleTimeout(tableId: number, userId: number): Promise<void> {
    const live = this.getLive(tableId);
    if (!live.hand) return;
    const acting = live.hand.players.find((p) => p.userId === userId);
    if (!acting || live.hand.actingSeat !== acting.seatIndex) return;
    const auto = timeoutAction(live.hand, userId);
    try {
      await this.applyPlayerAction(tableId, userId, auto.action, auto.amount);
    } catch (err) {
      this.logger.warn(`Timeout action failed: ${String(err)}`);
    }
  }

  async listTablesForUser() {
    const tables = await this.repo.listTables();
    const result = [];
    for (const t of tables) {
      if (t.status === POKER_TABLE_STATUS.DISABLED) continue;
      const seats = await this.repo.listSeats(t.id, true);
      result.push({
        id: t.id,
        name: t.name,
        smallBlind: t.smallBlind,
        bigBlind: t.bigBlind,
        minBuyIn: t.minBuyIn,
        maxBuyIn: t.maxBuyIn,
        maxSeats: t.maxSeats,
        rakePercent: t.rakePercent,
        rakeCap: t.rakeCap,
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

  /**
   * Sit at any open table for the given blinds.
   * If every matching table is full, a new table is created automatically.
   */
  async joinStake(userId: number, dto: JoinStakeDto) {
    const template =
      POKER_STAKE_TEMPLATES.find(
        (t) => t.smallBlind === dto.smallBlind && t.bigBlind === dto.bigBlind,
      ) ?? null;

    let table = await this.findOpenSeatForStakes(dto.smallBlind, dto.bigBlind);
    if (!table) {
      table = await this.spawnStakeTable({
        smallBlind: dto.smallBlind,
        bigBlind: dto.bigBlind,
        minBuyIn: template?.minBuyIn ?? dto.bigBlind * 20,
        maxBuyIn: template?.maxBuyIn ?? dto.bigBlind * 200,
        maxSeats: template?.maxSeats ?? 6,
        rakePercent: template?.rakePercent ?? 5,
        rakeCap: template?.rakeCap ?? 3,
        baseName: template?.name ?? stakeBaseName(dto.smallBlind, dto.bigBlind),
      });
    }

    return this.buyIn(userId, table.id, {
      amountUsd: dto.amountUsd,
    });
  }

  async buyIn(userId: number, tableId: number, dto: BuyInDto) {
    let table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    if (table.status !== POKER_TABLE_STATUS.OPEN) {
      throw new BadRequestException("Table is not open for buy-in");
    }

    const wallet = await this.wallet.getBalance(userId);
    // Like color game: sit against wallet balance — no escrow debit until a hand starts.
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

    // Already seated somewhere at this exact table?
    const existingHere = await this.repo.findSeatByUser(tableId, userId);
    if (
      existingHere &&
      existingHere.status !== POKER_SEAT_STATUS.LEFT
    ) {
      throw new BadRequestException({
        message: "Already seated at this table",
        tableId,
      });
    }

    // Global single-seat rule (any non-left seat on any table).
    const activeElsewhere = await this.repo.findActiveSeatByUser(userId);
    if (activeElsewhere && activeElsewhere.tableId !== tableId) {
      throw new BadRequestException({
        message: `Already seated at table ${activeElsewhere.tableId}`,
        tableId: activeElsewhere.tableId,
      });
    }

    let seats = await this.repo.listSeats(tableId, true);
    let targetTableId = tableId;

    // Table full → spill over to another same-stakes table (or create one).
    if (seats.length >= table.maxSeats) {
      if (dto.seatIndex !== undefined && dto.seatIndex !== null) {
        throw new BadRequestException("Table is full");
      }
      const spill = await this.findOrCreateSpilloverTable(table);
      table = spill;
      targetTableId = spill.id;
      seats = await this.repo.listSeats(targetTableId, true);
      const existingSpill = await this.repo.findSeatByUser(
        targetTableId,
        userId,
      );
      if (
        existingSpill &&
        existingSpill.status !== POKER_SEAT_STATUS.LEFT
      ) {
        throw new BadRequestException({
          message: "Already seated at this stake",
          tableId: targetTableId,
        });
      }
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

    await this.repo.clearLeftSeatsAt(targetTableId, seatIndex);
    const existing = await this.repo.findSeatByUser(targetTableId, userId);
    if (existing && existing.status === POKER_SEAT_STATUS.LEFT) {
      await this.repo.deleteSeat(existing.id);
    }

    // Spill and direct buy-in both create inside the same exclusive transaction.
    try {
      await this.repo.createSeatExclusive({
        tableId: targetTableId,
        userId,
        seatIndex,
        stackUsd: amount,
      });
    } catch (err) {
      const tableIdBusy =
        err instanceof Error &&
        err.message === "ALREADY_SEATED" &&
        typeof (err as Error & { tableId?: number }).tableId === "number"
          ? (err as Error & { tableId: number }).tableId
          : null;
      if (tableIdBusy != null) {
        throw new BadRequestException({
          message: `Already seated at table ${tableIdBusy}`,
          tableId: tableIdBusy,
        });
      }
      // Unique-index race: PostgreSQL SQLSTATE 23505 only (not index name).
      if (isPgUniqueViolation(err)) {
        const again = await this.repo.findActiveSeatByUser(userId);
        throw new BadRequestException({
          message: again
            ? `Already seated at table ${again.tableId}`
            : "Already seated at another table",
          tableId: again?.tableId ?? undefined,
        });
      }
      throw err;
    }

    await this.maybeStartHand(targetTableId);
    const state = await this.buildTableState(targetTableId, userId);
    this.emitRoom({
      type: "table_state",
      tableId: targetTableId,
      payload: state,
    });
    return {
      ...state,
      redirectedFromTableId:
        targetTableId !== tableId ? tableId : undefined,
    };
  }

  private async findOpenSeatForStakes(smallBlind: number, bigBlind: number) {
    const open = await this.repo.listOpenTables();
    const matches = open
      .filter((t) => sameStakes(t, { smallBlind, bigBlind }))
      .sort((a, b) => a.id - b.id);

    for (const t of matches) {
      const seats = await this.repo.listSeats(t.id, true);
      if (seats.length < t.maxSeats) return t;
    }
    return null;
  }

  private async findOrCreateSpilloverTable(fullTable: {
    id: number;
    name: string;
    smallBlind: string;
    bigBlind: string;
    minBuyIn: string;
    maxBuyIn: string;
    maxSeats: number;
    rakePercent: string;
    rakeCap: string;
  }) {
    const openSeat = await this.findOpenSeatForStakes(
      Number(fullTable.smallBlind),
      Number(fullTable.bigBlind),
    );
    if (openSeat) return openSeat;

    return this.spawnStakeTable({
      smallBlind: Number(fullTable.smallBlind),
      bigBlind: Number(fullTable.bigBlind),
      minBuyIn: Number(fullTable.minBuyIn),
      maxBuyIn: Number(fullTable.maxBuyIn),
      maxSeats: fullTable.maxSeats,
      rakePercent: Number(fullTable.rakePercent),
      rakeCap: Number(fullTable.rakeCap),
      baseName:
        fullTable.name.replace(/\s+#\d+$/, "")
        || stakeBaseName(
          Number(fullTable.smallBlind),
          Number(fullTable.bigBlind),
        ),
    });
  }

  private async spawnStakeTable(cfg: {
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
    maxSeats: number;
    rakePercent: number;
    rakeCap: number;
    baseName: string;
  }) {
    const open = await this.repo.listOpenTables();
    const sameCount = open.filter((t) =>
      sameStakes(t, cfg),
    ).length;
    const name =
      sameCount === 0 ? cfg.baseName : `${cfg.baseName} #${sameCount + 1}`;

    const row = await this.repo.createTable({
      name,
      smallBlind: normalizeUsd(cfg.smallBlind),
      bigBlind: normalizeUsd(cfg.bigBlind),
      minBuyIn: normalizeUsd(cfg.minBuyIn),
      maxBuyIn: normalizeUsd(cfg.maxBuyIn),
      maxSeats: cfg.maxSeats,
      rakePercent: normalizeUsd(cfg.rakePercent),
      rakeCap: normalizeUsd(cfg.rakeCap),
    });
    this.getLive(row.id);
    this.logger.log(`Auto-created poker table ${row.id} (${name})`);
    return row;
  }

  async cashOut(userId: number, tableId: number, force = false) {
    const live = this.getLive(tableId);
    /** All-in leave: keep seat until settleHand deletes it. */
    let deferSeatDelete = false;

    if (live.hand) {
      const player = live.hand.players.find((p) => p.userId === userId);
      if (player && !player.folded) {
        if (!force) {
          throw new BadRequestException("Cannot cash out during an active hand");
        }

        // Spec 10.7: all-in leavers stay in the hand; never fold; settle credits winnings.
        if (player.allIn) {
          live.allInLeftUserIds ??= new Set();
          live.allInLeftUserIds.add(userId);
          deferSeatDelete = true;
        } else if (live.hand.actingSeat === player.seatIndex) {
          try {
            await this.applyPlayerAction(tableId, userId, "fold");
          } catch (err) {
            this.logger.warn(`Mid-hand fold on leave failed: ${String(err)}`);
          }
        } else if (live.hand) {
          // Out-of-turn leave: fold through the engine (advances / ends hand).
          const beforeLen = live.hand.actionHistory.length;
          const folded = forceFold(live.hand, userId);
          if (folded.ok) {
            live.hand = folded.state;
            const newActions = live.hand.actionHistory.slice(beforeLen);
            for (const a of newActions) {
              await this.repo.createAction({
                handId: live.hand.handId,
                userId: a.userId,
                street: a.street,
                action: a.action,
                amountUsd: normalizeUsd(a.amount),
              });
            }
            if (folded.handOver && folded.result) {
              await this.settleHand(tableId, folded.result);
            } else {
              this.scheduleTurnTimeout(tableId);
              this.broadcastTableState(tableId);
            }
          }
        }
      }

      // Non–all-in: return chips still behind (pot chips stay). Skip if settle already ran.
      if (live.hand) {
        const leaving = live.hand.players.find((p) => p.userId === userId);
        if (
          leaving &&
          !leaving.allIn &&
          !(live.walletReturned?.has(userId))
        ) {
          const handId = live.hand.handId;
          const remaining = normalizeUsd(leaving.stack);
          if (Number(remaining) > 0) {
            await this.wallet.creditFromCardHand({
              userId,
              amountUsd: remaining,
              game: "poker",
              handId,
              description: `Poker leave mid-hand #${handId}`,
            });
          }
          leaving.stack = 0;
          live.walletReturned ??= new Set();
          live.walletReturned.add(userId);
        }
      }
    }

    const seat = await this.repo.findSeatByUser(tableId, userId);
    if (
      !seat ||
      (seat.status !== POKER_SEAT_STATUS.SEATED &&
        seat.status !== POKER_SEAT_STATUS.SITTING_OUT)
    ) {
      if (force) {
        const state = await this.buildTableState(tableId, userId);
        return { cashOutUsd: "0", table: state };
      }
      throw new BadRequestException("Not seated at this table");
    }

    if (deferSeatDelete) {
      // Keep non-left seat so single-seat rule blocks other tables until settle.
      await this.repo.updateSeat(seat.id, {
        status: POKER_SEAT_STATUS.SITTING_OUT,
        stackUsd: "0",
      });
    } else {
      // Between hands: stack is a wallet mirror — nothing to credit.
      await this.repo.deleteSeat(seat.id);
    }

    const state = await this.buildTableState(tableId, userId);
    this.emitRoom({ type: "table_state", tableId, payload: state });
    return { cashOutUsd: "0", table: state };
  }

  async maybeStartHand(tableId: number): Promise<void> {
    const table = await this.repo.findTable(tableId);
    if (!table || table.status !== POKER_TABLE_STATUS.OPEN) return;
    // Game switched off by an admin: finish hands in progress, start no new ones.
    if (this.gameSettings && !(await this.gameSettings.isEnabled("poker"))) return;

    const live = this.getLive(tableId);
    if (live.hand) return;

    const seats = await this.repo.listSeats(tableId, true);
    // Refresh stacks from live wallet (color-game style balance).
    const funded: Array<{ userId: number; seatIndex: number; stack: number; seatId: number }> = [];
    for (const s of seats) {
      // Migrate legacy buy-in escrow (wallet empty, seat still funded) back to wallet.
      let bal = await this.wallet.getBalance(s.userId);
      const seatStack = Number(s.stackUsd);
      if (seatStack > Number(bal.balanceUsd) + 1e-8) {
        await this.wallet.creditPokerCashout({
          userId: s.userId,
          amountUsd: seatStack,
          seatId: s.id,
          description: `Poker seat #${s.id} escrow → wallet`,
        });
        bal = await this.wallet.getBalance(s.userId);
      }
      const stack = Number(normalizeUsd(bal.balanceUsd));
      await this.repo.updateSeat(s.id, { stackUsd: normalizeUsd(stack) });
      if (stack >= Number(table.minBuyIn) && stack > 0) {
        funded.push({
          userId: s.userId,
          seatIndex: s.seatIndex,
          stack,
          seatId: s.id,
        });
      }
    }
    if (funded.length < 2) return;

    const handNo = table.handCounter + 1;
    await this.repo.bumpHandCounter(tableId, handNo);

    const dealerCandidates = funded
      .map((s) => s.seatIndex)
      .sort((a, b) => a - b);
    let dealerSeat = live.dealerSeat;
    const idx = dealerCandidates.indexOf(dealerSeat);
    dealerSeat =
      idx >= 0
        ? dealerCandidates[(idx + 1) % dealerCandidates.length]!
        : dealerCandidates[0]!;
    live.dealerSeat = dealerSeat;

    const handRow = await this.repo.createHand({
      tableId,
      handNo,
      dealerSeat,
    });

    // Reserve each stack from wallet (balance read + debit are one CAS in wallet).
    // A failed debit sits that player out; hand continues if ≥2 remain funded.
    const reserved: Array<{
      userId: number;
      seatIndex: number;
      stack: number;
      seatId: number;
    }> = [];
    for (const s of funded) {
      try {
        await this.wallet.debitForCardHand({
          userId: s.userId,
          amountUsd: s.stack,
          game: "poker",
          handId: handRow.id,
        });
        reserved.push(s);
      } catch (err) {
        this.logger.warn(
          `Poker reserve failed user=${s.userId} hand=${handRow.id}: ${String(err)}`,
        );
        await this.repo.updateSeat(s.seatId, {
          status: POKER_SEAT_STATUS.SITTING_OUT,
        });
        this.emitRoom({
          type: "error",
          tableId,
          userId: s.userId,
          payload: {
            message:
              "Insufficient balance to start the hand — you are sitting out",
          },
        });
      }
    }

    if (reserved.length < 2) {
      for (const r of reserved) {
        await this.wallet.creditFromCardHand({
          userId: r.userId,
          amountUsd: r.stack,
          game: "poker",
          handId: handRow.id,
          description: `Poker hand #${handRow.id} reserve rollback`,
        });
      }
      const claimed = await this.repo.claimHandStatus(
        handRow.id,
        POKER_HAND_STATUS.ACTIVE,
        POKER_HAND_STATUS.CANCELLING,
      );
      if (claimed) {
        await this.wallet.refundOutstandingCardHand({
          game: "poker",
          handId: handRow.id,
        });
        await this.repo.updateHand(handRow.id, {
          status: POKER_HAND_STATUS.CANCELLED,
          endedAt: new Date().toISOString(),
        });
      }
      this.logger.warn(
        `Poker hand #${handRow.id} cancelled — fewer than 2 funded players`,
      );
      return;
    }

    // Rotate dealer among players who actually reserved.
    const reservedSeats = reserved.map((s) => s.seatIndex).sort((a, b) => a - b);
    if (!reservedSeats.includes(dealerSeat)) {
      dealerSeat = reservedSeats[0]!;
      live.dealerSeat = dealerSeat;
    }

    const engineState = startHand({
      handId: handRow.id,
      handNo,
      seats: reserved.map((s) => ({
        userId: s.userId,
        seatIndex: s.seatIndex,
        stack: s.stack,
      })),
      dealerSeat,
      smallBlind: Number(table.smallBlind),
      bigBlind: Number(table.bigBlind),
      rakePercent: Number(table.rakePercent),
      rakeCap: Number(table.rakeCap),
    });

    live.walletReturned = new Set();

    for (const p of engineState.players) {
      await this.repo.createHandPlayer({
        handId: handRow.id,
        userId: p.userId,
        seatIndex: p.seatIndex,
        holeCards: p.holeCards.join(","),
        startingStack: normalizeUsd(p.stack + p.totalBet),
      });
      await this.syncSeatStack(tableId, p.userId, p.stack);
    }

    // Persist blind posts as actions
    for (const a of engineState.actionHistory) {
      await this.repo.createAction({
        handId: handRow.id,
        userId: a.userId,
        street: a.street,
        action: a.action,
        amountUsd: normalizeUsd(a.amount),
      });
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
    action: PokerActionType,
    amount?: number,
  ) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    if (table.status === POKER_TABLE_STATUS.FROZEN) {
      throw new BadRequestException("Table is frozen");
    }

    const live = this.getLive(tableId);
    if (!live.hand) throw new BadRequestException("No active hand");

    const beforeLen = live.hand.actionHistory.length;
    const result = applyAction(live.hand, userId, action, amount);
    if (!result.ok) {
      throw new BadRequestException(result.error);
    }

    live.hand = result.state;
    const newActions = live.hand.actionHistory.slice(beforeLen);
    for (const a of newActions) {
      await this.repo.createAction({
        handId: live.hand.handId,
        userId: a.userId,
        street: a.street,
        action: a.action,
        amountUsd: normalizeUsd(a.amount),
      });
    }

    this.emitRoom({
      type: "action_applied",
      tableId,
      payload: { userId, action, amount: amount ?? 0 },
    });

    if (result.handOver && result.result) {
      await this.settleHand(tableId, result.result);
      return;
    }

    this.scheduleTurnTimeout(tableId);
    this.broadcastTableState(tableId);
  }

  private async settleHand(tableId: number, result: HandResult): Promise<void> {
    const live = this.getLive(tableId);
    const hand = live.hand;
    if (!hand) return;

    // Claim settle lock before any credits — cancel path cannot touch settling.
    const claimed = await this.repo.claimHandStatus(
      hand.handId,
      POKER_HAND_STATUS.ACTIVE,
      POKER_HAND_STATUS.SETTLING,
    );
    if (!claimed) {
      this.logger.warn(
        `settleHand skipped — could not claim hand ${hand.handId}`,
      );
      return;
    }

    // Detach immediately so a racing timeout/action cannot settle twice.
    live.hand = null;
    this.clearTurnTimer(live);

    const handPlayers = await this.repo.listHandPlayers(hand.handId);
    const returned = live.walletReturned ?? new Set<number>();
    const allInLeft = live.allInLeftUserIds;

    // Persist payout targets BEFORE credits so a crash can resume from DB.
    for (const p of hand.players) {
      const hp = handPlayers.find((x) => x.userId === p.userId);
      const starting = Number(hp?.startingStack ?? 0);
      const ending = returned.has(p.userId) ? 0 : p.stack;
      const net = (returned.has(p.userId) ? p.stack : ending) - starting;
      const winInfo = result.winners.find((w) => w.userId === p.userId);
      if (hp) {
        await this.repo.updateHandPlayer(hp.id, {
          endingStack: normalizeUsd(ending),
          betTotal: normalizeUsd(p.totalBet),
          netPnl: normalizeUsd(net),
          handRank: winInfo?.handRank ?? null,
          holeCards: p.holeCards.join(","),
        });
      }
    }

    await this.repo.updateHand(hand.handId, {
      board: hand.board.join(","),
      potUsd: normalizeUsd(result.pot),
      rakeUsd: normalizeUsd(result.rake),
    });

    await this.applySettlingCredits(tableId, hand.handId, allInLeft);

    await this.repo.updateHand(hand.handId, {
      status: POKER_HAND_STATUS.COMPLETED,
      endedAt: new Date().toISOString(),
    });

    live.walletReturned = undefined;
    live.allInLeftUserIds = undefined;
    this.emitRoom({
      type: "hand_ended",
      tableId,
      payload: {
        handId: hand.handId,
        winners: result.winners,
        rake: result.rake,
        pot: result.pot,
        board: result.board,
      },
    });
    this.broadcastTableState(tableId);

    this.clearRestartTimer(live);
    live.restartTimer = setTimeout(() => {
      live.restartTimer = undefined;
      void this.maybeStartHand(tableId);
    }, 1500);
  }

  /** Resume or finish a hand stuck in `settling` using persisted endingStack targets. */
  private async finishSettlingFromDb(
    tableId: number,
    handId: number,
  ): Promise<void> {
    const hand = await this.repo.findHand(handId);
    if (!hand || hand.status === POKER_HAND_STATUS.COMPLETED) return;
    if (hand.status !== POKER_HAND_STATUS.SETTLING) {
      const claimed = await this.repo.claimHandStatus(
        handId,
        hand.status,
        POKER_HAND_STATUS.SETTLING,
      );
      if (!claimed && hand.status !== POKER_HAND_STATUS.SETTLING) return;
    }

    await this.applySettlingCredits(tableId, handId, undefined);
    await this.repo.updateHand(handId, {
      status: POKER_HAND_STATUS.COMPLETED,
      endedAt: new Date().toISOString(),
    });
    const live = this.getLive(tableId);
    live.hand = null;
    live.walletReturned = undefined;
    live.allInLeftUserIds = undefined;
    this.broadcastTableState(tableId);
    this.logger.warn(`Finished settling hand ${handId} on table ${tableId}`);
  }

  private async applySettlingCredits(
    tableId: number,
    handId: number,
    allInLeftUserIds: Set<number> | undefined,
  ): Promise<void> {
    const handPlayers = await this.repo.listHandPlayers(handId);
    for (const hp of handPlayers) {
      const ending = Number(hp.endingStack ?? 0);
      if (ending > 0) {
        await this.wallet.creditCardHandUpToTarget({
          userId: hp.userId,
          targetUsd: ending,
          game: "poker",
          handId,
          description: `Poker hand #${handId} settle`,
        });
      }
      const bal = await this.wallet.getBalance(hp.userId);
      if (allInLeftUserIds?.has(hp.userId)) {
        const leftSeat = await this.repo.findSeatByUser(tableId, hp.userId);
        if (leftSeat) await this.repo.deleteSeat(leftSeat.id);
      } else {
        await this.syncSeatStack(tableId, hp.userId, Number(bal.balanceUsd));
      }
    }
  }

  private async finishCancellingFromDb(
    tableId: number,
    handId: number,
  ): Promise<void> {
    await this.wallet.refundOutstandingCardHand({
      game: "poker",
      handId,
    });
    const players = await this.repo.listHandPlayers(handId);
    for (const hp of players) {
      const bal = await this.wallet.getBalance(hp.userId);
      await this.syncSeatStack(tableId, hp.userId, Number(bal.balanceUsd));
    }
    await this.repo.updateHand(handId, {
      status: POKER_HAND_STATUS.CANCELLED,
      rakeUsd: "0",
      endedAt: new Date().toISOString(),
    });
    const live = this.getLive(tableId);
    live.hand = null;
    live.walletReturned = undefined;
    this.broadcastTableState(tableId);
  }

  private async syncSeatStack(
    tableId: number,
    userId: number,
    stack: number,
  ): Promise<void> {
    const seat = await this.repo.findSeatByUser(tableId, userId);
    if (seat) {
      await this.repo.updateSeat(seat.id, {
        stackUsd: normalizeUsd(stack),
      });
    }
  }

  async broadcastTableState(tableId: number): Promise<void> {
    // Emit a generic marker; gateway builds per-socket views
    this.emitRoom({
      type: "table_state",
      tableId,
      payload: { refresh: true },
    });
  }

  async buildTableState(tableId: number, viewerUserId: number | null) {
    const table = await this.repo.findTable(tableId);
    if (!table) throw new NotFoundException("Table not found");
    const seats = await this.repo.listSeats(tableId, true);
    const live = this.getLive(tableId);
    const hand = live.hand;
    const handOver = hand?.street === "showdown";

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
        folded: hp?.folded ?? false,
        allIn: hp?.allIn ?? false,
        betStreet: hp?.betStreet ?? 0,
        holeCards: hp
          ? publicPlayerView(hp, viewerUserId, !!handOver).holeCards
          : null,
      };
    });

    const legal =
      hand && viewerUserId ? legalActions(hand, viewerUserId) : null;

    return {
      id: table.id,
      name: table.name,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      minBuyIn: table.minBuyIn,
      maxBuyIn: table.maxBuyIn,
      maxSeats: table.maxSeats,
      rakePercent: table.rakePercent,
      rakeCap: table.rakeCap,
      status: table.status,
      seats: seatViews,
      hand: hand
        ? {
            handId: hand.handId,
            handNo: hand.handNo,
            street: hand.street,
            board: hand.board,
            pot: hand.pot,
            currentBet: hand.currentBet,
            actingSeat: hand.actingSeat,
            dealerSeat: hand.dealerSeat,
            legal,
            turnEndsAt: live.turnEndsAt
              ? new Date(live.turnEndsAt).toISOString()
              : null,
            turnTimeoutMs: TURN_TIMEOUT_MS,
            serverNow: new Date().toISOString(),
          }
        : null,
    };
  }

  // --- Admin ---

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

  async adminCreateTable(dto: CreatePokerTableDto) {
    const row = await this.repo.createTable({
      name: dto.name,
      smallBlind: normalizeUsd(dto.smallBlind),
      bigBlind: normalizeUsd(dto.bigBlind),
      minBuyIn: normalizeUsd(dto.minBuyIn),
      maxBuyIn: normalizeUsd(dto.maxBuyIn),
      maxSeats: dto.maxSeats ?? 6,
      rakePercent: normalizeUsd(dto.rakePercent ?? 5),
      rakeCap: normalizeUsd(dto.rakeCap ?? 3),
    });
    this.getLive(row.id);
    return row;
  }

  async adminUpdateTable(id: number, dto: UpdatePokerTableDto) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    const data: Record<string, string | number> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.smallBlind !== undefined) data.smallBlind = normalizeUsd(dto.smallBlind);
    if (dto.bigBlind !== undefined) data.bigBlind = normalizeUsd(dto.bigBlind);
    if (dto.minBuyIn !== undefined) data.minBuyIn = normalizeUsd(dto.minBuyIn);
    if (dto.maxBuyIn !== undefined) data.maxBuyIn = normalizeUsd(dto.maxBuyIn);
    if (dto.maxSeats !== undefined) data.maxSeats = dto.maxSeats;
    if (dto.rakePercent !== undefined) {
      data.rakePercent = normalizeUsd(dto.rakePercent);
    }
    if (dto.rakeCap !== undefined) data.rakeCap = normalizeUsd(dto.rakeCap);
    if (dto.status !== undefined) data.status = dto.status;
    return this.repo.updateTable(id, data);
  }

  async freezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    this.clearRestartTimer(this.getLive(id));
    return this.repo.updateTable(id, { status: POKER_TABLE_STATUS.FROZEN });
  }

  async unfreezeTable(id: number) {
    const table = await this.repo.findTable(id);
    if (!table) throw new NotFoundException("Table not found");
    const updated = await this.repo.updateTable(id, {
      status: POKER_TABLE_STATUS.OPEN,
    });
    await this.maybeStartHand(id);
    return updated;
  }

  /**
   * Force-end: claim active→cancelling, refund, mark cancelled.
   * Never cancels a hand that has started settling.
   */
  async forceEndHand(tableId: number, quiet = false) {
    const live = this.getLive(tableId);
    const hand = live.hand;
    this.clearRestartTimer(live);

    const settling = await this.repo.findHandByTableStatus(
      tableId,
      POKER_HAND_STATUS.SETTLING,
    );
    if (settling) {
      await this.finishSettlingFromDb(tableId, settling.id);
      return { ok: true, settled: true };
    }

    const cancelling = await this.repo.findHandByTableStatus(
      tableId,
      POKER_HAND_STATUS.CANCELLING,
    );
    if (cancelling && !hand) {
      await this.finishCancellingFromDb(tableId, cancelling.id);
      return { ok: true };
    }

    const activeDb = await this.repo.findActiveHand(tableId);
    if (!hand && !activeDb && !cancelling) {
      if (quiet) return { ok: true };
      throw new BadRequestException("No active hand");
    }

    this.clearTurnTimer(live);

    if (hand) {
      const claimed = await this.repo.claimHandStatus(
        hand.handId,
        POKER_HAND_STATUS.ACTIVE,
        POKER_HAND_STATUS.CANCELLING,
      );
      if (!claimed) {
        // Another caller owns cancel/settle — do not refund again (avoids double-pay).
        // Settling is finished only via rehydrate/sweep (single owner).
        const again = await this.repo.findHand(hand.handId);
        if (again?.status === POKER_HAND_STATUS.SETTLING) {
          await this.finishSettlingFromDb(tableId, hand.handId);
        }
        live.hand = null;
        return { ok: true };
      }

      const handPlayers = await this.repo.listHandPlayers(hand.handId);
      const pot = hand.pot;
      const totalContrib = hand.players.reduce((s, p) => s + p.totalBet, 0);
      const returned = live.walletReturned ?? new Set<number>();

      for (const p of hand.players) {
        const hp = handPlayers.find((x) => x.userId === p.userId);
        const refund =
          totalContrib > 0 ? (p.totalBet / totalContrib) * pot : 0;
        const ending = returned.has(p.userId) ? refund : p.stack + refund;
        if (hp) {
          await this.repo.updateHandPlayer(hp.id, {
            endingStack: normalizeUsd(ending),
            betTotal: normalizeUsd(p.totalBet),
            netPnl: normalizeUsd(ending - Number(hp.startingStack)),
            holeCards: p.holeCards.join(","),
          });
        }
      }

      // Outstanding-based refund is idempotent if we crash mid-loop.
      await this.wallet.refundOutstandingCardHand({
        game: "poker",
        handId: hand.handId,
      });
      for (const p of hand.players) {
        const bal = await this.wallet.getBalance(p.userId);
        await this.syncSeatStack(tableId, p.userId, Number(bal.balanceUsd));
      }
      live.walletReturned = undefined;

      await this.repo.updateHand(hand.handId, {
        status: POKER_HAND_STATUS.CANCELLED,
        board: hand.board.join(","),
        potUsd: normalizeUsd(hand.pot),
        rakeUsd: "0",
        endedAt: new Date().toISOString(),
      });
      live.hand = null;
    } else if (activeDb) {
      const claimed = await this.repo.claimHandStatus(
        activeDb.id,
        POKER_HAND_STATUS.ACTIVE,
        POKER_HAND_STATUS.CANCELLING,
      );
      if (!claimed) {
        // Claimer owns refund; avoid parallel refundOutstanding double-pay.
        return { ok: true };
      }
      const players = await this.repo.listHandPlayers(activeDb.id);
      for (const hp of players) {
        await this.repo.updateHandPlayer(hp.id, {
          endingStack: hp.startingStack,
          netPnl: "0",
        });
      }
      await this.finishCancellingFromDb(tableId, activeDb.id);
    }

    this.broadcastTableState(tableId);
    return { ok: true };
  }

  async adminListHands(tableId?: number, page = 1, limit = 50) {
    const { items: hands, total } = await this.repo.listHandsPage({
      tableId,
      page,
      limit,
    });
    const out = [];
    for (const h of hands) {
      const players = await this.repo.listHandPlayers(h.id);
      out.push({
        ...h,
        winners: players
          .filter((p) => Number(p.netPnl) > 0)
          .map((p) => ({
            userId: p.userId,
            netPnl: p.netPnl,
            handRank: p.handRank,
          })),
      });
    }
    return {
      items: out,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async adminHandDetail(handId: number) {
    const hand = await this.repo.findHand(handId);
    if (!hand) throw new NotFoundException("Hand not found");
    const players = await this.repo.listHandPlayers(handId);
    const actions = await this.repo.listActions(handId);
    return { ...hand, players, actions };
  }

  async myHands(userId: number, page = 1, limit = 50) {
    const { items: rows, total } = await this.repo.listHandPlayersForUserPage(
      userId,
      page,
      limit,
    );
    const out = [];
    for (const r of rows) {
      const hand = await this.repo.findHand(r.handId);
      out.push({
        handId: r.handId,
        tableId: hand?.tableId,
        handNo: hand?.handNo,
        status: hand?.status,
        potUsd: hand?.potUsd,
        rakeUsd: hand?.rakeUsd,
        netPnl: r.netPnl,
        handRank: r.handRank,
        startedAt: hand?.startedAt,
        endedAt: hand?.endedAt,
      });
    }
    return {
      items: out,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async myStats(userId: number) {
    const rows = await this.repo.listHandPlayersForUser(userId, 1000);
    let net = "0";
    let biggest = "0";
    for (const r of rows) {
      net = addUsd(net, r.netPnl);
      const hand = await this.repo.findHand(r.handId);
      if (hand && Number(hand.potUsd) > Number(biggest)) {
        biggest = hand.potUsd;
      }
    }
    return {
      handsPlayed: rows.length,
      netPnl: net,
      biggestPot: biggest,
    };
  }

  async adminPlayerStats(page = 1, limit = 50) {
    const rows = await this.repo.allHandPlayers();
    const byUser = new Map<
      number,
      { hands: number; netPnl: string; volume: string }
    >();
    for (const r of rows) {
      const cur = byUser.get(r.userId) ?? {
        hands: 0,
        netPnl: "0",
        volume: "0",
      };
      cur.hands += 1;
      cur.netPnl = addUsd(cur.netPnl, r.netPnl);
      cur.volume = addUsd(cur.volume, r.betTotal);
      byUser.set(r.userId, cur);
    }
    const all = [...byUser.entries()]
      .map(([userId, s]) => ({ userId, ...s }))
      .sort((a, b) => b.hands - a.hands);
    const total = all.length;
    const offset = (page - 1) * limit;
    return {
      items: all.slice(offset, offset + limit),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async adminOverview() {
    const tables = await this.repo.listTables();
    const open = tables.filter((t) => t.status === POKER_TABLE_STATUS.OPEN)
      .length;
    const activeHands = await this.repo.countActiveHands();
    const hands = await this.repo.listHands({ limit: 5000 });
    let totalRake = "0";
    let totalVolume = "0";
    for (const h of hands) {
      totalRake = addUsd(totalRake, h.rakeUsd);
      totalVolume = addUsd(totalVolume, h.potUsd);
    }
    // live memory active
    let liveActive = 0;
    for (const l of this.live.values()) {
      if (l.hand) liveActive += 1;
    }
    return {
      tablesOpen: open,
      tablesTotal: tables.length,
      activeHands: Math.max(activeHands, liveActive),
      totalRake,
      totalVolume,
    };
  }
}
