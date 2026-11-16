/**
 * Behavioural test: orphan sweep xact advisory lock.
 * Requires DATABASE_URL. Skips when unset.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!hasDb)("F-01 orphan sweep xact advisory lock", () => {
  let repo: InstanceType<typeof import("./poker.repository.ts").PokerRepository>;
  let tableId: number;
  let handId: number;

  beforeAll(async () => {
    loadEnvFile();
    const dbMod = await import("../prisma/db.ts");
    await dbMod.connectDatabase();
    const { PrismaService } = await import("../prisma/prisma.service.ts");
    const { PokerRepository } = await import("./poker.repository.ts");
    repo = new PokerRepository(new PrismaService());

    const t = await repo.createTable({
      name: `orphan-lock-${Date.now()}`,
      smallBlind: "1",
      bigBlind: "2",
      minBuyIn: "20",
      maxBuyIn: "200",
      maxSeats: 6,
      rakePercent: "0",
      rakeCap: "0",
    });
    tableId = t.id;
    // startedAt in the past so it is an orphan candidate
    const hand = await repo.createHand({
      tableId,
      handNo: 1,
      dealerSeat: 0,
    });
    handId = hand.id;
    const url = process.env.DATABASE_URL!;
    const { default: pg } = await import("pg");
    const c = new pg.Client(url);
    await c.connect();
    await c.query(
      `UPDATE "PokerHand" SET "startedAt" = $1 WHERE id = $2`,
      [new Date(Date.now() - 60_000).toISOString(), handId],
    );
    await c.end();
  }, 60_000);

  afterAll(async () => {
    if (!hasDb) return;
    try {
      const url = process.env.DATABASE_URL!;
      const { default: pg } = await import("pg");
      const c = new pg.Client(url);
      await c.connect();
      await c.query(`DELETE FROM "PokerHand" WHERE id = $1`, [handId]);
      await c.query(`DELETE FROM "PokerTable" WHERE id = $1`, [tableId]);
      await c.end();
    } catch {
      /* ignore cleanup */
    }
  });

  it("two concurrent sweeps: one acquires and claims, one skips; later sweep still acquires", async () => {
    const beforeIso = new Date().toISOString();

    // Hold the same xact lock on a separate connection while the other tries.
    const { default: pg } = await import("pg");
    const holder = new pg.Client(process.env.DATABASE_URL!);
    await holder.connect();
    await holder.query("BEGIN");
    const got = await holder.query<{ got: boolean }>(
      `SELECT pg_try_advisory_xact_lock(87201401, 1) AS got`,
    );
    expect(got.rows[0]?.got).toBe(true);

    const duringHold = await repo.tryOrphanSweepClaims({ beforeIso });
    expect(duringHold.acquired).toBe(false);
    expect(duringHold.claimedActiveIds).toEqual([]);

    await holder.query("COMMIT"); // releases xact lock
    await holder.end();

    // Lock must not be leaked — a later sweep acquires and claims.
    const after = await repo.tryOrphanSweepClaims({ beforeIso });
    expect(after.acquired).toBe(true);
    expect(after.claimedActiveIds).toContain(handId);

    const hand = await repo.findHand(handId);
    expect(hand?.status).toBe("cancelling");

    // Parallel claims after already cancelling: both may acquire lock; neither re-claims active.
    const [a, b] = await Promise.all([
      repo.tryOrphanSweepClaims({ beforeIso }),
      repo.tryOrphanSweepClaims({ beforeIso }),
    ]);
    const acquiredCount = [a, b].filter((r) => r.acquired).length;
    expect(acquiredCount).toBeGreaterThanOrEqual(1);
    expect(a.claimedActiveIds).not.toContain(handId);
    expect(b.claimedActiveIds).not.toContain(handId);
  }, 60_000);
});
