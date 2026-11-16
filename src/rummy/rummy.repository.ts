import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import {
  RUMMY_HAND_STATUS,
  RUMMY_SEAT_STATUS,
  RUMMY_TABLE_STATUS,
} from "./rummy.constants.ts";

@Injectable()
export class RummyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get orm() {
    return this.prisma.client.orm.public;
  }

  // ── Tables ──────────────────────────────────────────────────────────────────

  async listTables() {
    return this.orm.RummyTable.orderBy((t) => t.id.asc()).all();
  }

  async findTable(id: number) {
    return this.orm.RummyTable.where({ id }).first();
  }

  async createTable(data: {
    name: string;
    pointValue: string;
    minBuyIn: string;
    maxBuyIn: string;
    maxSeats: number;
    status?: string;
  }) {
    return this.orm.RummyTable.create({
      name: data.name,
      pointValue: data.pointValue,
      minBuyIn: data.minBuyIn,
      maxBuyIn: data.maxBuyIn,
      maxSeats: data.maxSeats,
      status: data.status ?? RUMMY_TABLE_STATUS.OPEN,
      handCounter: 0,
    });
  }

  async updateTable(id: number, data: Record<string, string | number>) {
    await this.orm.RummyTable.where({ id }).update(data);
    return this.findTable(id);
  }

  // ── Seats ───────────────────────────────────────────────────────────────────

  async listSeats(tableId: number, onlyActive = true) {
    const rows = await this.orm.RummySeat.where({ tableId }).all();
    if (!onlyActive) return rows;
    return rows.filter((s) => s.status === RUMMY_SEAT_STATUS.SEATED);
  }

  async findSeatByUser(tableId: number, userId: number) {
    return this.orm.RummySeat.where({ tableId, userId }).first();
  }

  async findSeat(id: number) {
    return this.orm.RummySeat.where({ id }).first();
  }

  async createSeat(data: {
    tableId: number;
    userId: number;
    seatIndex: number;
    stackUsd: string;
  }) {
    return this.orm.RummySeat.create({
      tableId: data.tableId,
      userId: data.userId,
      seatIndex: data.seatIndex,
      stackUsd: data.stackUsd,
      status: RUMMY_SEAT_STATUS.SEATED,
    });
  }

  async updateSeat(
    id: number,
    data: Partial<{ stackUsd: string; status: string }>,
  ) {
    await this.orm.RummySeat.where({ id }).update(data);
    return this.findSeat(id);
  }

  async deleteSeat(id: number) {
    await this.orm.RummySeat.where({ id }).delete();
  }

  async clearLeftSeatsAt(tableId: number, seatIndex: number) {
    const rows = await this.orm.RummySeat.where({ tableId }).all();
    for (const row of rows) {
      if (row.seatIndex === seatIndex && row.status === RUMMY_SEAT_STATUS.LEFT) {
        await this.deleteSeat(row.id);
      }
    }
  }

  // ── Hands ────────────────────────────────────────────────────────────────────

  async createHand(data: { tableId: number; handNo: number }) {
    return this.orm.RummyHand.create({
      tableId: data.tableId,
      handNo: data.handNo,
      status: RUMMY_HAND_STATUS.RUNNING,
    });
  }

  async updateHand(
    id: number,
    data: Partial<{
      status: string;
      winnerUserId: number | null;
      endedAt: string;
    }>,
  ) {
    await this.orm.RummyHand.where({ id }).update(data);
    return this.orm.RummyHand.where({ id }).first();
  }

  async findHand(id: number) {
    return this.orm.RummyHand.where({ id }).first();
  }

  async findActiveHand(tableId: number) {
    return this.orm.RummyHand.where({
      tableId,
      status: RUMMY_HAND_STATUS.RUNNING,
    }).first();
  }

  async listHands(opts: { tableId?: number; limit?: number }) {
    if (opts.tableId) {
      return this.orm.RummyHand.where({ tableId: opts.tableId })
        .orderBy((h) => h.startedAt.desc())
        .limit(opts.limit ?? 50)
        .all();
    }
    return this.orm.RummyHand.orderBy((h) => h.startedAt.desc())
      .limit(opts.limit ?? 50)
      .all();
  }

  async bumpHandCounter(tableId: number, next: number) {
    await this.orm.RummyTable.where({ id: tableId }).update({ handCounter: next });
  }

  async ensureDefaultTable(): Promise<void> {
    const existing = await this.orm.RummyTable.all();
    if (existing.length > 0) return;
    await this.createTable({
      name: "Rummy 1pt",
      pointValue: normalizeUsd(1),
      minBuyIn: normalizeUsd(20),
      maxBuyIn: normalizeUsd(500),
      maxSeats: 4,
    });
  }
}
