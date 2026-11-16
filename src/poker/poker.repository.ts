import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import {
  POKER_HAND_STATUS,
  POKER_SEAT_STATUS,
  POKER_TABLE_STATUS,
} from "./poker.constants.ts";

@Injectable()
export class PokerRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get orm() {
    return this.prisma.client.orm.public;
  }

  async listTables() {
    return this.orm.PokerTable.orderBy((t) => t.id.asc()).all();
  }

  async listOpenTables() {
    return this.orm.PokerTable.where({ status: POKER_TABLE_STATUS.OPEN }).all();
  }

  async findTable(id: number) {
    return this.orm.PokerTable.where({ id }).first();
  }

  async createTable(data: {
    name: string;
    smallBlind: string;
    bigBlind: string;
    minBuyIn: string;
    maxBuyIn: string;
    maxSeats: number;
    rakePercent: string;
    rakeCap: string;
    status?: string;
  }) {
    return this.orm.PokerTable.create({
      name: data.name,
      smallBlind: data.smallBlind,
      bigBlind: data.bigBlind,
      minBuyIn: data.minBuyIn,
      maxBuyIn: data.maxBuyIn,
      maxSeats: data.maxSeats,
      rakePercent: data.rakePercent,
      rakeCap: data.rakeCap,
      status: data.status ?? POKER_TABLE_STATUS.OPEN,
      handCounter: 0,
    });
  }

  async updateTable(
    id: number,
    data: Record<string, string | number>,
  ) {
    await this.orm.PokerTable.where({ id }).update(data);
    return this.findTable(id);
  }

  async listSeats(tableId: number, onlyActive = true) {
    const rows = await this.orm.PokerSeat.where({ tableId }).all();
    if (!onlyActive) return rows;
    return rows.filter((s) => s.status === POKER_SEAT_STATUS.SEATED);
  }

  async findSeatByUser(tableId: number, userId: number) {
    return this.orm.PokerSeat.where({ tableId, userId }).first();
  }

  /** Any non-left seat for this user across all tables (single-seat rule). */
  async findActiveSeatByUser(userId: number) {
    const rows = await this.orm.PokerSeat.where({ userId }).all();
    return (
      rows.find((s) => s.status !== POKER_SEAT_STATUS.LEFT) ?? null
    );
  }

  /**
   * Create a SEATED row only if the user has no other non-left seat.
   * Runs in a transaction; unique index is the final race guard.
   */
  async createSeatExclusive(data: {
    tableId: number;
    userId: number;
    seatIndex: number;
    stackUsd: string;
  }) {
    return this.prisma.client.transaction(async (tx) => {
      const rows = await tx.orm.public.PokerSeat.where({
        userId: data.userId,
      }).all();
      const active = rows.find((s) => s.status !== POKER_SEAT_STATUS.LEFT);
      if (active) {
        const err = new Error("ALREADY_SEATED");
        (err as Error & { tableId: number }).tableId = active.tableId;
        throw err;
      }
      return tx.orm.public.PokerSeat.create({
        tableId: data.tableId,
        userId: data.userId,
        seatIndex: data.seatIndex,
        stackUsd: data.stackUsd,
        status: POKER_SEAT_STATUS.SEATED,
      });
    });
  }

  async findSeat(id: number) {
    return this.orm.PokerSeat.where({ id }).first();
  }

  async createSeat(data: {
    tableId: number;
    userId: number;
    seatIndex: number;
    stackUsd: string;
  }) {
    return this.orm.PokerSeat.create({
      tableId: data.tableId,
      userId: data.userId,
      seatIndex: data.seatIndex,
      stackUsd: data.stackUsd,
      status: POKER_SEAT_STATUS.SEATED,
    });
  }

  async updateSeat(
    id: number,
    data: Partial<{ stackUsd: string; status: string; seatIndex: number }>,
  ) {
    await this.orm.PokerSeat.where({ id }).update(data);
    return this.findSeat(id);
  }

  async deleteSeat(id: number) {
    await this.orm.PokerSeat.where({ id }).delete();
  }

  /** Remove vacated seats that still hold a seatIndex unique slot. */
  async clearLeftSeatsAt(tableId: number, seatIndex: number) {
    const rows = await this.orm.PokerSeat.where({ tableId }).all();
    for (const row of rows) {
      if (
        row.seatIndex === seatIndex &&
        row.status === POKER_SEAT_STATUS.LEFT
      ) {
        await this.deleteSeat(row.id);
      }
    }
  }

  async createHand(data: {
    tableId: number;
    handNo: number;
    dealerSeat: number;
  }) {
    return this.orm.PokerHand.create({
      tableId: data.tableId,
      handNo: data.handNo,
      status: POKER_HAND_STATUS.ACTIVE,
      potUsd: "0",
      rakeUsd: "0",
      dealerSeat: data.dealerSeat,
    });
  }

  async updateHand(
    id: number,
    data: Partial<{
      status: string;
      board: string | null;
      potUsd: string;
      rakeUsd: string;
      endedAt: string;
    }>,
  ) {
    await this.orm.PokerHand.where({ id }).update(data);
    return this.orm.PokerHand.where({ id }).first();
  }

  /**
   * Atomic status claim: UPDATE … WHERE id AND status = fromStatus.
   * Returns true only if this caller flipped the row (compare-and-swap).
   */
  async claimHandStatus(
    id: number,
    fromStatus: string,
    toStatus: string,
  ): Promise<boolean> {
    // True CAS via SQL RETURNING — ORM compound where is not reliable here.
    const url = process.env.DATABASE_URL;
    if (!url) {
      const row = await this.orm.PokerHand.where({ id }).first();
      if (!row || row.status !== fromStatus) return false;
      await this.orm.PokerHand.where({ id }).update({ status: toStatus });
      return true;
    }
    const { default: pg } = await import("pg");
    const client = new pg.Client(url);
    await client.connect();
    try {
      const result = await client.query<{ id: number }>(
        `UPDATE "PokerHand" SET status = $1 WHERE id = $2 AND status = $3 RETURNING id`,
        [toStatus, id, fromStatus],
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      await client.end();
    }
  }

  /** Active / cancelling / settling hands older than `beforeIso` (for orphan sweep). */
  async listOrphanHandCandidates(beforeIso: string) {
    const [active, cancelling, settling] = await Promise.all([
      this.orm.PokerHand.where({ status: POKER_HAND_STATUS.ACTIVE }).all(),
      this.orm.PokerHand.where({ status: POKER_HAND_STATUS.CANCELLING }).all(),
      this.orm.PokerHand.where({ status: POKER_HAND_STATUS.SETTLING }).all(),
    ]);
    return [...active, ...cancelling, ...settling].filter(
      (h) => h.startedAt < beforeIso,
    );
  }

  /**
   * Multi-instance-safe orphan sweep claim:
   * one interactive transaction holds pg_try_advisory_xact_lock, then CAS-claims
   * active→cancelling for eligible hands. Lock releases on commit/rollback
   * (safe with connection pooling — never session-scoped).
   *
   * @param skipHandIds hands this process still holds in memory (do not claim)
   */
  async tryOrphanSweepClaims(opts: {
    beforeIso: string;
    skipHandIds?: Set<number>;
  }): Promise<{
    acquired: boolean;
    claimedActiveIds: number[];
    settlingIds: number[];
    alreadyCancellingIds: number[];
  }> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return {
        acquired: false,
        claimedActiveIds: [],
        settlingIds: [],
        alreadyCancellingIds: [],
      };
    }

    const skip = opts.skipHandIds ?? new Set<number>();
    const { default: pg } = await import("pg");
    const client = new pg.Client(url);
    await client.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ got: boolean }>(
        `SELECT pg_try_advisory_xact_lock(87201401, 1) AS got`,
      );
      if (!lock.rows[0]?.got) {
        await client.query("ROLLBACK");
        return {
          acquired: false,
          claimedActiveIds: [],
          settlingIds: [],
          alreadyCancellingIds: [],
        };
      }

      const rows = await client.query<{
        id: number;
        status: string;
        started_at: string;
      }>(
        `SELECT id, status, "startedAt" AS started_at
         FROM "PokerHand"
         WHERE status IN ('active', 'cancelling', 'settling')
           AND "startedAt" < $1
         FOR UPDATE`,
        [opts.beforeIso],
      );

      const claimedActiveIds: number[] = [];
      const settlingIds: number[] = [];
      const alreadyCancellingIds: number[] = [];

      for (const row of rows.rows) {
        if (skip.has(row.id)) continue;
        if (row.status === POKER_HAND_STATUS.SETTLING) {
          settlingIds.push(row.id);
          continue;
        }
        if (row.status === POKER_HAND_STATUS.CANCELLING) {
          alreadyCancellingIds.push(row.id);
          continue;
        }
        if (row.status === POKER_HAND_STATUS.ACTIVE) {
          const upd = await client.query<{ id: number }>(
            `UPDATE "PokerHand" SET status = $1
             WHERE id = $2 AND status = $3
             RETURNING id`,
            [
              POKER_HAND_STATUS.CANCELLING,
              row.id,
              POKER_HAND_STATUS.ACTIVE,
            ],
          );
          if ((upd.rowCount ?? 0) > 0) {
            claimedActiveIds.push(row.id);
          }
        }
      }

      await client.query("COMMIT");
      return {
        acquired: true,
        claimedActiveIds,
        settlingIds,
        alreadyCancellingIds,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async createHandPlayer(data: {
    handId: number;
    userId: number;
    seatIndex: number;
    holeCards: string;
    startingStack: string;
  }) {
    return this.orm.PokerHandPlayer.create({
      handId: data.handId,
      userId: data.userId,
      seatIndex: data.seatIndex,
      holeCards: data.holeCards,
      startingStack: data.startingStack,
      betTotal: "0",
      netPnl: "0",
    });
  }

  async updateHandPlayer(
    id: number,
    data: Partial<{
      endingStack: string;
      betTotal: string;
      netPnl: string;
      handRank: string | null;
      holeCards: string;
    }>,
  ) {
    await this.orm.PokerHandPlayer.where({ id }).update(data);
  }

  async listHandPlayers(handId: number) {
    return this.orm.PokerHandPlayer.where({ handId }).all();
  }

  async createAction(data: {
    handId: number;
    userId: number;
    street: string;
    action: string;
    amountUsd: string;
  }) {
    return this.orm.PokerAction.create({
      handId: data.handId,
      userId: data.userId,
      street: data.street,
      action: data.action,
      amountUsd: data.amountUsd,
    });
  }

  async listHands(opts: { tableId?: number; limit?: number }) {
    let q = this.orm.PokerHand.orderBy((h) => h.startedAt.desc());
    if (opts.tableId) {
      q = this.orm.PokerHand.where({ tableId: opts.tableId }).orderBy((h) =>
        h.startedAt.desc(),
      );
    }
    return q.limit(opts.limit ?? 50).all();
  }

  async listHandsPage(opts: {
    tableId?: number;
    page: number;
    limit: number;
  }) {
    const offset = (opts.page - 1) * opts.limit;
    if (opts.tableId) {
      const tableId = opts.tableId;
      const [agg, items] = await Promise.all([
        this.orm.PokerHand.where({ tableId }).aggregate((a) => ({
          count: a.count(),
        })),
        this.orm.PokerHand.where({ tableId })
          .orderBy((h) => h.startedAt.desc())
          .offset(offset)
          .limit(opts.limit)
          .all(),
      ]);
      return { items, total: Number(agg.count ?? 0) };
    }
    const [agg, items] = await Promise.all([
      this.orm.PokerHand.aggregate((a) => ({ count: a.count() })),
      this.orm.PokerHand.orderBy((h) => h.startedAt.desc())
        .offset(offset)
        .limit(opts.limit)
        .all(),
    ]);
    return { items, total: Number(agg.count ?? 0) };
  }

  async findHand(id: number) {
    return this.orm.PokerHand.where({ id }).first();
  }

  async listActions(handId: number) {
    return this.orm.PokerAction.where({ handId })
      .orderBy((a) => a.createdAt.asc())
      .all();
  }

  async listHandPlayersForUser(userId: number, limit = 50) {
    return this.orm.PokerHandPlayer.where({ userId })
      .orderBy((p) => p.createdAt.desc())
      .limit(limit)
      .all();
  }

  async listHandPlayersForUserPage(
    userId: number,
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;
    const [agg, items] = await Promise.all([
      this.orm.PokerHandPlayer.where({ userId }).aggregate((a) => ({
        count: a.count(),
      })),
      this.orm.PokerHandPlayer.where({ userId })
        .orderBy((p) => p.createdAt.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    return { items, total: Number(agg.count ?? 0) };
  }

  async allHandPlayers() {
    return this.orm.PokerHandPlayer.all();
  }

  async countActiveHands() {
    const rows = await this.orm.PokerHand.where({
      status: POKER_HAND_STATUS.ACTIVE,
    }).all();
    return rows.length;
  }

  async findActiveHand(tableId: number) {
    return this.orm.PokerHand.where({
      tableId,
      status: POKER_HAND_STATUS.ACTIVE,
    }).first();
  }

  async findHandByTableStatus(tableId: number, status: string) {
    return this.orm.PokerHand.where({ tableId, status }).first();
  }

  async bumpHandCounter(tableId: number, next: number) {
    await this.orm.PokerTable.where({ id: tableId }).update({
      handCounter: next,
    });
  }

  async ensureStakeTables(
    templates: Array<{
      name: string;
      smallBlind: number;
      bigBlind: number;
      minBuyIn: number;
      maxBuyIn: number;
      maxSeats: number;
      rakePercent: number;
      rakeCap: number;
    }>,
  ): Promise<void> {
    const existing = await this.listTables();
    for (const t of templates) {
      const hasStake = existing.some(
        (row) =>
          Number(row.smallBlind) === t.smallBlind
          && Number(row.bigBlind) === t.bigBlind
          && row.status === POKER_TABLE_STATUS.OPEN,
      );
      if (hasStake) continue;
      await this.createTable({
        name: t.name,
        smallBlind: normalizeUsd(t.smallBlind),
        bigBlind: normalizeUsd(t.bigBlind),
        minBuyIn: normalizeUsd(t.minBuyIn),
        maxBuyIn: normalizeUsd(t.maxBuyIn),
        maxSeats: t.maxSeats,
        rakePercent: normalizeUsd(t.rakePercent),
        rakeCap: normalizeUsd(t.rakeCap),
      });
    }
  }
}
