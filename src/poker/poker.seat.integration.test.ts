/**
 * Real-DB integration tests for single-seat enforcement.
 * Requires DATABASE_URL. Skips when unset.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1]!.trim();
      let val = m[2]!.trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}
loadEnvFile();

const hasDb = Boolean(process.env.DATABASE_URL);

function seatedTableIdFromBadRequest(err: BadRequestException): number | undefined {
  const res = err.getResponse();
  if (typeof res === "string") return undefined;
  if (typeof res !== "object" || res === null) return undefined;
  const obj = res as { tableId?: number; message?: unknown };
  if (typeof obj.tableId === "number") return obj.tableId;
  if (typeof obj.message === "object" && obj.message !== null) {
    const inner = obj.message as { tableId?: number };
    if (typeof inner.tableId === "number") return inner.tableId;
  }
  return undefined;
}

describe.skipIf(!hasDb)("poker single-seat (real DB)", () => {
  // Loaded after env so postgres() sees DATABASE_URL.
  let db: typeof import("../prisma/db.ts").db;
  let repo: InstanceType<typeof import("./poker.repository.ts").PokerRepository>;
  let poker: InstanceType<typeof import("./poker.service.ts").PokerService>;
  let normalizeUsd: typeof import("../wallet/wallet.math.ts").normalizeUsd;

  let userId: number;
  let tableA: number;
  let tableB: number;
  let tableSpillFull: number;

  beforeAll(async () => {
    loadEnvFile();
    const dbMod = await import("../prisma/db.ts");
    const { connectDatabase } = dbMod;
    db = dbMod.db;
    await connectDatabase();

    const c = new pg.Client(process.env.DATABASE_URL);
    await c.connect();
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS poker_seat_one_active_per_user
      ON "PokerSeat" ("userId")
      WHERE status <> 'left'
    `);
    await c.end();

    const { PrismaService } = await import("../prisma/prisma.service.ts");
    const { WalletService } = await import("../wallet/wallet.service.ts");
    const { PokerRepository } = await import("./poker.repository.ts");
    const { PokerService } = await import("./poker.service.ts");
    const math = await import("../wallet/wallet.math.ts");
    normalizeUsd = math.normalizeUsd;

    const prisma = new PrismaService();
    repo = new PokerRepository(prisma);
    const wallet = new WalletService(prisma);
    poker = new PokerService(repo, wallet);

    const email = `seat-it-${Date.now()}@test.local`;
    const user = await db.orm.public.User.create({
      email,
      passwordHash: "x",
      name: "Seat IT",
    });
    userId = user.id;

    let w = await db.orm.public.Wallet.where({ userId }).first();
    if (!w) {
      await db.orm.public.Wallet.create({
        userId,
        balanceUsd: "1000",
        vaultUsd: "0",
        currency: "USD",
      });
    } else {
      await db.orm.public.Wallet.where({ id: w.id }).update({
        balanceUsd: "1000",
      });
    }

    const mk = async (name: string, maxSeats = 6) => {
      const t = await repo.createTable({
        name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        smallBlind: "0.50",
        bigBlind: "1.00",
        minBuyIn: "20",
        maxBuyIn: "200",
        maxSeats,
        rakePercent: "5",
        rakeCap: "3",
      });
      return t.id;
    };

    tableA = await mk("IT-A");
    tableB = await mk("IT-B");
    tableSpillFull = await mk("IT-FULL", 1);

    const filler = await db.orm.public.User.create({
      email: `filler-${Date.now()}@test.local`,
      passwordHash: "x",
      name: "Filler",
    });
    await db.orm.public.Wallet.create({
      userId: filler.id,
      balanceUsd: "1000",
      vaultUsd: "0",
      currency: "USD",
    });
    await poker.buyIn(filler.id, tableSpillFull, { amountUsd: 50 });
  }, 60_000);

  afterAll(async () => {
    try {
      const seat = await repo.findActiveSeatByUser(userId);
      if (seat) await repo.deleteSeat(seat.id);
    } catch {
      /* ignore */
    }
  });

  it("two parallel buyIn to different tables → exactly one succeeds", async () => {
    const existing = await repo.findActiveSeatByUser(userId);
    if (existing) await poker.cashOut(userId, existing.tableId, true);

    const results = await Promise.allSettled([
      poker.buyIn(userId, tableA, { amountUsd: 50 }),
      poker.buyIn(userId, tableB, { amountUsd: 50 }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    const err = (bad[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    const active = await repo.findActiveSeatByUser(userId);
    expect(active).toBeTruthy();
    const tid = seatedTableIdFromBadRequest(err as BadRequestException);
    if (tid !== undefined) expect(tid).toBe(active!.tableId);
  });

  it("unique-index violation maps to 400 with tableId, never 500", async () => {
    const active = await repo.findActiveSeatByUser(userId);
    expect(active).toBeTruthy();
    let code: string | undefined;
    try {
      await db.orm.public.PokerSeat.create({
        tableId: tableB,
        userId,
        seatIndex: 0,
        stackUsd: normalizeUsd(50),
        status: "seated",
      });
    } catch (e) {
      let cur: unknown = e;
      for (let i = 0; i < 6 && cur; i += 1) {
        if (
          typeof cur === "object" &&
          cur !== null &&
          "code" in cur &&
          typeof (cur as { code: unknown }).code === "string"
        ) {
          code = (cur as { code: string }).code;
          if (code === "23505") break;
        }
        cur =
          typeof cur === "object" && cur !== null && "cause" in cur
            ? (cur as { cause: unknown }).cause
            : undefined;
      }
    }
    expect(code).toBe("23505");

    try {
      await poker.buyIn(userId, tableB, { amountUsd: 50 });
      expect.fail("should reject");
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getStatus()).toBe(400);
      expect(seatedTableIdFromBadRequest(e as BadRequestException)).toBe(
        active!.tableId,
      );
    }
  });

  it("seated at A, joinStake elsewhere → rejected", async () => {
    const active = await repo.findActiveSeatByUser(userId);
    if (!active || active.tableId !== tableA) {
      if (active) await poker.cashOut(userId, active.tableId, true);
      await poker.buyIn(userId, tableA, { amountUsd: 50 });
    }
    try {
      await poker.joinStake(userId, {
        smallBlind: 0.25,
        bigBlind: 0.5,
        amountUsd: 50,
      });
      expect.fail("should reject");
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getStatus()).toBe(400);
      expect(seatedTableIdFromBadRequest(e as BadRequestException)).toBe(
        tableA,
      );
    }
  });

  it("cash out of A, then join B → succeeds", async () => {
    const active = await repo.findActiveSeatByUser(userId);
    if (active) await poker.cashOut(userId, active.tableId, true);
    const state = await poker.buyIn(userId, tableB, { amountUsd: 50 });
    expect(state.id).toBe(tableB);
    await poker.cashOut(userId, tableB, true);
  });

  it("spill path while seated elsewhere → rejected", async () => {
    await poker.buyIn(userId, tableA, { amountUsd: 50 });
    try {
      await poker.buyIn(userId, tableSpillFull, { amountUsd: 50 });
      expect.fail("should reject");
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getStatus()).toBe(400);
      expect(seatedTableIdFromBadRequest(e as BadRequestException)).toBe(
        tableA,
      );
    }
    await poker.cashOut(userId, tableA, true);
  });
});
