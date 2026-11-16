import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import { TP_HAND_STATUS, TP_SEAT_STATUS, TP_TABLE_STATUS } from "./teen-patti.constants.ts";

@Injectable()
export class TeenPattiRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get orm() {
    return this.prisma.client.orm.public;
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  async listTables() {
    return this.orm.TeenPattiTable.orderBy((t) => t.id.asc()).all();
  }

  async listOpenTables() {
    return this.orm.TeenPattiTable.where({ status: TP_TABLE_STATUS.OPEN }).all();
  }

  async findTable(id: number) {
    return this.orm.TeenPattiTable.where({ id }).first();
  }

  async createTable(data: {
    name: string;
    bootUsd: string;
    minBuyIn: string;
    maxBuyIn: string;
    maxSeats: number;
    status?: string;
  }) {
    return this.orm.TeenPattiTable.create({
      name: data.name,
      bootUsd: data.bootUsd,
      minBuyIn: data.minBuyIn,
      maxBuyIn: data.maxBuyIn,
      maxSeats: data.maxSeats,
      status: data.status ?? TP_TABLE_STATUS.OPEN,
      handCounter: 0,
    });
  }

  async updateTable(id: number, data: Record<string, string | number>) {
    await this.orm.TeenPattiTable.where({ id }).update(data);
    return this.findTable(id);
  }

  // ── Seats ──────────────────────────────────────────────────────────────────

  async listSeats(tableId: number, onlyActive = true) {
    const rows = await this.orm.TeenPattiSeat.where({ tableId }).all();
    if (!onlyActive) return rows;
    return rows.filter((s) => s.status === TP_SEAT_STATUS.SEATED);
  }

  async findSeatByUser(tableId: number, userId: number) {
    return this.orm.TeenPattiSeat.where({ tableId, userId }).first();
  }

  async findSeat(id: number) {
    return this.orm.TeenPattiSeat.where({ id }).first();
  }

  async createSeat(data: {
    tableId: number;
    userId: number;
    seatIndex: number;
    stackUsd: string;
  }) {
    return this.orm.TeenPattiSeat.create({
      tableId: data.tableId,
      userId: data.userId,
      seatIndex: data.seatIndex,
      stackUsd: data.stackUsd,
      status: TP_SEAT_STATUS.SEATED,
    });
  }

  async updateSeat(id: number, data: Partial<{ stackUsd: string; status: string }>) {
    await this.orm.TeenPattiSeat.where({ id }).update(data);
    return this.findSeat(id);
  }

  async deleteSeat(id: number) {
    await this.orm.TeenPattiSeat.where({ id }).delete();
  }

  async clearLeftSeatsAt(tableId: number, seatIndex: number) {
    const rows = await this.orm.TeenPattiSeat.where({ tableId }).all();
    for (const row of rows) {
      if (row.seatIndex === seatIndex && row.status === TP_SEAT_STATUS.LEFT) {
        await this.deleteSeat(row.id);
      }
    }
  }

  // ── Hands ──────────────────────────────────────────────────────────────────

  async createHand(data: { tableId: number; handNo: number }) {
    return this.orm.TeenPattiHand.create({
      tableId: data.tableId,
      handNo: data.handNo,
      status: TP_HAND_STATUS.RUNNING,
      potUsd: "0",
    });
  }

  async updateHand(
    id: number,
    data: Partial<{
      status: string;
      potUsd: string;
      winnerUserId: number | null;
      endedAt: string;
    }>,
  ) {
    await this.orm.TeenPattiHand.where({ id }).update(data);
    return this.orm.TeenPattiHand.where({ id }).first();
  }

  async findActiveHand(tableId: number) {
    return this.orm.TeenPattiHand.where({
      tableId,
      status: TP_HAND_STATUS.RUNNING,
    }).first();
  }

  async listHands(opts: { tableId?: number; limit?: number }) {
    let q = this.orm.TeenPattiHand.orderBy((h) => h.startedAt.desc());
    if (opts.tableId) {
      q = this.orm.TeenPattiHand.where({ tableId: opts.tableId }).orderBy(
        (h) => h.startedAt.desc(),
      );
    }
    return q.limit(opts.limit ?? 50).all();
  }

  async findHand(id: number) {
    return this.orm.TeenPattiHand.where({ id }).first();
  }

  async bumpHandCounter(tableId: number, next: number) {
    await this.orm.TeenPattiTable.where({ id: tableId }).update({ handCounter: next });
  }

  async countActiveHands() {
    const rows = await this.orm.TeenPattiHand.where({ status: TP_HAND_STATUS.RUNNING }).all();
    return rows.length;
  }

  async ensureDefaultTable(): Promise<void> {
    const existing = await this.orm.TeenPattiTable.all();
    if (existing.length > 0) return;
    await this.createTable({
      name: "Teen Patti – Boot 1",
      bootUsd: normalizeUsd(1),
      minBuyIn: normalizeUsd(10),
      maxBuyIn: normalizeUsd(500),
      maxSeats: 5,
    });
  }
}
