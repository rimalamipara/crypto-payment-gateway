/**
 * End-to-end money conservation on a real database.
 * Requires DATABASE_URL. Skips when unset.
 *
 * Invariant (every case): Σ wallets_before = Σ wallets_after + rake_taken
 * (cancelled / refunded hands → rake = 0).
 *
 * Cases for settlement-race / parallel-refund assert the *desired* post-hardening
 * invariant. They may fail until money-hardening items 1–2 are implemented.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WALLET_TX_TYPE } from "../wallet/constants/wallet-tx-type.ts";

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe.skipIf(!hasDb)("poker money e2e (real DB)", () => {
  let db: typeof import("../prisma/db.ts").db;
  let repo: InstanceType<typeof import("./poker.repository.ts").PokerRepository>;
  let poker: InstanceType<typeof import("./poker.service.ts").PokerService>;
  let wallet: InstanceType<typeof import("../wallet/wallet.service.ts").WalletService>;
  let tp: InstanceType<
    typeof import("../teen-patti/teen-patti.service.ts").TeenPattiService
  >;
  let tpRepo: InstanceType<
    typeof import("../teen-patti/teen-patti.repository.ts").TeenPattiRepository
  >;

  const users: number[] = [];
  let tableId: number;

  async function sumWallets(userIds: number[]): Promise<number> {
    let total = 0;
    for (const id of userIds) {
      const w = await db.orm.public.Wallet.where({ userId: id }).first();
      total += Number(w?.balanceUsd ?? 0);
    }
    return round2(total);
  }

  async function setBalance(userId: number, amount: string) {
    const w = await db.orm.public.Wallet.where({ userId }).first();
    if (!w) {
      await db.orm.public.Wallet.create({
        userId,
        balanceUsd: amount,
        vaultUsd: "0",
        currency: "USD",
      });
      return;
    }
    await db.orm.public.Wallet.where({ id: w.id }).update({
      balanceUsd: amount,
    });
  }

  async function quietTable() {
    const live = poker["getLive"](tableId);
    if (live.turnTimer) {
      clearTimeout(live.turnTimer);
      live.turnTimer = undefined;
    }
    if (live.restartTimer) {
      clearTimeout(live.restartTimer);
      live.restartTimer = undefined;
    }
    try {
      await poker.forceEndHand(tableId, true);
    } catch {
      /* none */
    }
    // Cancel any DB-active orphan if memory was cleared mid-start.
    try {
      await poker.forceEndHand(tableId, true);
    } catch {
      /* none */
    }
    live.hand = null;
  }

  async function ensureSeated(n: number, buyIn = 100) {
    await quietTable();
    for (const uid of users.slice(0, n)) {
      const active = await repo.findActiveSeatByUser(uid);
      if (active && active.tableId !== tableId) {
        await poker.cashOut(uid, active.tableId, true);
      }
      const seat = await repo.findSeatByUser(tableId, uid);
      if (!seat || seat.status === "left") {
        await setBalance(uid, "500");
        await poker.buyIn(uid, tableId, { amountUsd: buyIn });
      } else {
        await setBalance(uid, "500");
        await repo.updateSeat(seat.id, { stackUsd: String(buyIn) });
      }
    }
    // Third+ buy-ins can leave a hand running from player 2 — reset cleanly.
    await quietTable();
    // Re-mirror stacks without starting: temporarily freeze, update seats, unfreeze.
    const table = await repo.findTable(tableId);
    if (table) {
      await repo.updateTable(tableId, { status: "frozen" });
      for (const uid of users.slice(0, n)) {
        const seat = await repo.findSeatByUser(tableId, uid);
        if (seat && seat.status !== "left") {
          await setBalance(uid, "500");
          await repo.updateSeat(seat.id, { stackUsd: String(buyIn) });
        } else {
          await setBalance(uid, "500");
          await repo.updateTable(tableId, { status: "open" });
          await poker.buyIn(uid, tableId, { amountUsd: buyIn });
          await repo.updateTable(tableId, { status: "frozen" });
        }
      }
      await repo.updateTable(tableId, { status: "open" });
    }
  }

  /** Fold acting player until hand settles or cancels. */
  async function foldUntilDone(max = 40) {
    const live = poker["getLive"](tableId);
    for (let i = 0; i < max && live.hand; i += 1) {
      const h = live.hand;
      const actor = h.players.find((p) => p.seatIndex === h.actingSeat);
      if (!actor || actor.folded) break;
      const nonFolded = h.players.filter((p) => !p.folded);
      if (nonFolded.length <= 1) break;
      try {
        await poker.applyPlayerAction(tableId, actor.userId, "fold");
      } catch {
        break;
      }
    }
  }

  async function countHandCredits(handId: number): Promise<Map<number, number>> {
    const txs = await db.orm.public.WalletTransaction.where({
      referenceType: "poker_hand",
      referenceId: handId,
    }).all();
    const credits = new Map<number, number>();
    for (const tx of txs) {
      if (tx.type !== WALLET_TX_TYPE.CREDIT_POKER_HAND) continue;
      const w = await db.orm.public.Wallet.where({ id: tx.walletId }).first();
      if (!w) continue;
      credits.set(w.userId, (credits.get(w.userId) ?? 0) + Number(tx.amountUsd));
    }
    return credits;
  }

  async function handRake(handId: number): Promise<number> {
    const h = await repo.findHand(handId);
    return round2(Number(h?.rakeUsd ?? 0));
  }

  beforeAll(async () => {
    loadEnvFile();
    const dbMod = await import("../prisma/db.ts");
    db = dbMod.db;
    await dbMod.connectDatabase();

    const { PrismaService } = await import("../prisma/prisma.service.ts");
    const { WalletService } = await import("../wallet/wallet.service.ts");
    const { PokerRepository } = await import("./poker.repository.ts");
    const { PokerService } = await import("./poker.service.ts");
    const { TeenPattiRepository } = await import(
      "../teen-patti/teen-patti.repository.ts"
    );
    const { TeenPattiService } = await import(
      "../teen-patti/teen-patti.service.ts"
    );

    const prisma = new PrismaService();
    repo = new PokerRepository(prisma);
    wallet = new WalletService(prisma);
    poker = new PokerService(repo, wallet);
    tpRepo = new TeenPattiRepository(prisma);
    tp = new TeenPattiService(tpRepo, wallet);

    const stamp = Date.now();
    for (let i = 0; i < 4; i += 1) {
      const u = await db.orm.public.User.create({
        email: `money-e2e-${stamp}-${i}@test.local`,
        passwordHash: "x",
        name: `Money${i}`,
      });
      users.push(u.id);
      await db.orm.public.Wallet.create({
        userId: u.id,
        balanceUsd: "500",
        vaultUsd: "0",
        currency: "USD",
      });
    }

    const t = await repo.createTable({
      name: `money-e2e-${stamp}`,
      smallBlind: "1",
      bigBlind: "2",
      minBuyIn: "20",
      maxBuyIn: "500",
      maxSeats: 6,
      rakePercent: "0",
      rakeCap: "0",
    });
    tableId = t.id;
  }, 90_000);

  afterAll(async () => {
    await quietTable();
    for (const uid of users) {
      try {
        const s = await repo.findActiveSeatByUser(uid);
        if (s) await poker.cashOut(uid, s.tableId, true);
      } catch {
        /* ignore */
      }
    }
  });

  it("normal uncontested pot: wallets conserved (rake 0)", async () => {
    const ids = users.slice(0, 3);
    await ensureSeated(3);
    const before = await sumWallets(ids);

    await poker.maybeStartHand(tableId);
    const live = poker["getLive"](tableId);
    expect(live.hand).toBeTruthy();
    const handId = live.hand!.handId;

    await foldUntilDone();
    expect(live.hand).toBeNull();

    const rake = await handRake(handId);
    const after = await sumWallets(ids);
    expect(after).toBe(round2(before - rake));
  });

  it(
    "mid-hand leave (non all-in): wallets conserved",
    async () => {
      const ids = users.slice(0, 3);
      await ensureSeated(3);
      const before = await sumWallets(ids);

      await poker.maybeStartHand(tableId);
      const live = poker["getLive"](tableId);
      expect(live.hand).toBeTruthy();
      const handId = live.hand!.handId;

      const leaver = live.hand!.players.find(
        (p) => !p.allIn && p.seatIndex !== live.hand!.actingSeat,
      );
      expect(leaver).toBeTruthy();
      await poker.cashOut(leaver!.userId, tableId, true);

      await foldUntilDone();
      if (live.hand) {
        await poker.forceEndHand(tableId, true);
      }
      // Cancel post-settle restart so a new hand cannot re-reserve wallets.
      await quietTable();

      const rake = await handRake(handId);
      const after = await sumWallets(ids);
      expect(after).toBe(round2(before - rake));
    },
    60_000,
  );

  it("server restart mid-hand: reserves returned exactly once", async () => {
    const ids = users.slice(0, 3);
    await ensureSeated(3);
    const before = await sumWallets(ids);

    await poker.maybeStartHand(tableId);
    const live = poker["getLive"](tableId);
    expect(live.hand).toBeTruthy();
    const handId = live.hand!.handId;

    // Crash: drop memory, leave DB hand active.
    live.hand = null;
    live.walletReturned = undefined;

    await poker.forceEndHand(tableId, true);
    await poker.forceEndHand(tableId, true);

    const after = await sumWallets(ids);
    expect(after).toBe(before);

    const credits = await countHandCredits(handId);
    const txs = await db.orm.public.WalletTransaction.where({
      referenceType: "poker_hand",
      referenceId: handId,
    }).all();
    const debits = new Map<number, number>();
    for (const tx of txs) {
      if (tx.type !== WALLET_TX_TYPE.DEBIT_POKER_HAND) continue;
      const w = await db.orm.public.Wallet.where({ id: tx.walletId }).first();
      if (!w) continue;
      debits.set(w.userId, (debits.get(w.userId) ?? 0) + Number(tx.amountUsd));
    }
    for (const [uid, d] of debits) {
      expect(round2(credits.get(uid) ?? 0)).toBe(round2(d));
    }
  });

  it("parallel orphan refund: each wallet credited once (hardening #1)", async () => {
    const ids = users.slice(0, 2);
    await ensureSeated(2);
    const before = await sumWallets(ids);

    await poker.maybeStartHand(tableId);
    const live = poker["getLive"](tableId);
    expect(live.hand).toBeTruthy();
    const handId = live.hand!.handId;
    live.hand = null;
    live.walletReturned = undefined;

    // Parallel force-end: only the CAS claimer refunds; second is a no-op.
    await Promise.all([
      poker.forceEndHand(tableId, true),
      poker.forceEndHand(tableId, true),
    ]);
    await poker.forceEndHand(tableId, true);

    const after = await sumWallets(ids);
    expect(after).toBe(before);

    const txs = await db.orm.public.WalletTransaction.where({
      referenceType: "poker_hand",
      referenceId: handId,
      type: WALLET_TX_TYPE.CREDIT_POKER_HAND,
    }).all();
    // Per wallet: net credit amount equals one full reserve (not 2×).
    const byWallet = new Map<number, number>();
    for (const tx of txs) {
      byWallet.set(tx.walletId, (byWallet.get(tx.walletId) ?? 0) + Number(tx.amountUsd));
    }
    const debitTxs = await db.orm.public.WalletTransaction.where({
      referenceType: "poker_hand",
      referenceId: handId,
      type: WALLET_TX_TYPE.DEBIT_POKER_HAND,
    }).all();
    const debitByWallet = new Map<number, number>();
    for (const tx of debitTxs) {
      debitByWallet.set(
        tx.walletId,
        (debitByWallet.get(tx.walletId) ?? 0) + Number(tx.amountUsd),
      );
    }
    for (const [wid, debit] of debitByWallet) {
      expect(round2(byWallet.get(wid) ?? 0)).toBe(round2(debit));
    }
  });

  it("restart during settlement must not double-pay (hardening #2)", async () => {
    const ids = users.slice(0, 2);
    await ensureSeated(2);
    const before = await sumWallets(ids);

    await poker.maybeStartHand(tableId);
    const live = poker["getLive"](tableId);
    expect(live.hand).toBeTruthy();
    const handId = live.hand!.handId;

    // Crash mid-settle: claim settling, persist full-reserve return targets,
    // credit only one player, drop memory.
    const handPlayers = await repo.listHandPlayers(handId);
    for (const hp of handPlayers) {
      await repo.updateHandPlayer(hp.id, {
        endingStack: hp.startingStack,
        netPnl: "0",
      });
    }
    expect(
      await repo.claimHandStatus(handId, "active", "settling"),
    ).toBe(true);

    const first = handPlayers[0]!;
    await wallet.creditCardHandUpToTarget({
      userId: first.userId,
      targetUsd: first.startingStack,
      game: "poker",
      handId,
    });
    live.hand = null;

    // Must finish settle (not cancel). Second call is a no-op.
    await poker.forceEndHand(tableId, true);
    await poker.forceEndHand(tableId, true);

    const hand = await repo.findHand(handId);
    expect(hand?.status).toBe("completed");
    expect(await sumWallets(ids)).toBe(before);
  });

  it(
    "hand-start debit failure: sit-out failed player, no money leak",
    async () => {
      const ids = users.slice(0, 3);
      await ensureSeated(3);
      const before = await sumWallets(ids);

      const failId = users[1]!;
      const orig = wallet.debitForCardHand.bind(wallet);
      wallet.debitForCardHand = async (input) => {
        if (input.userId === failId) {
          throw new Error("Insufficient wallet balance");
        }
        return orig(input);
      };

      try {
        await poker.maybeStartHand(tableId);
        const live = poker["getLive"](tableId);
        const seat1 = await repo.findSeatByUser(tableId, failId);
        expect(seat1?.status).toBe("sitting_out");
        expect(live.hand).toBeTruthy();
        if (live.hand) await quietTable();
        expect(await sumWallets(ids)).toBe(before);
        if (seat1) {
          await repo.updateSeat(seat1.id, { status: "seated" });
        }
      } finally {
        wallet.debitForCardHand = orig;
      }
    },
    60_000,
  );

  it(
    "shared wallet: poker seat + teen seat cannot overdraw",
    async () => {
      const uid = users[0]!;
      await quietTable();
      const active = await repo.findActiveSeatByUser(uid);
      if (active) await poker.cashOut(uid, active.tableId, true);

      await setBalance(uid, "80");
      await poker.buyIn(uid, tableId, { amountUsd: 50 });

      const teen = await tpRepo.createTable({
        name: `teen-money-${Date.now()}`,
        bootUsd: "1",
        minBuyIn: "10",
        maxBuyIn: "100",
        maxSeats: 3,
      });

      try {
        await tp.buyIn(uid, teen.id, { amountUsd: 50 });
      } catch {
        /* cross-game / balance — still assert non-negative below */
      }

      expect(await sumWallets([uid])).toBeGreaterThanOrEqual(0);

      await setBalance(users[1]!, "500");
      const seat1 = await repo.findSeatByUser(tableId, users[1]!);
      if (!seat1 || seat1.status === "left") {
        await poker.buyIn(users[1]!, tableId, { amountUsd: 100 });
      }

      await quietTable();
      await poker.maybeStartHand(tableId);
      expect(Number((await wallet.getBalance(uid)).balanceUsd)).toBeGreaterThanOrEqual(
        0,
      );

      try {
        await tp["maybeStartHand"](teen.id);
      } catch {
        /* underfunded */
      }
      expect(Number((await wallet.getBalance(uid)).balanceUsd)).toBeGreaterThanOrEqual(
        0,
      );

      await quietTable();
      try {
        await tp.forceEndHand(teen.id, true);
      } catch {
        /* ignore */
      }
      try {
        await tp.cashOut(uid, teen.id, true);
      } catch {
        /* ignore */
      }
      try {
        await poker.cashOut(uid, tableId, true);
      } catch {
        /* ignore */
      }
    },
    60_000,
  );
});
