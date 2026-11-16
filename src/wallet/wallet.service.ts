import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { WALLET_TX_TYPE } from "./constants/wallet-tx-type.ts";
import type {
  WalletResponseDto,
  WalletTransactionDto,
} from "./dto/wallet-response.dto.ts";
import { addUsd, gteUsd, normalizeUsd, subUsd } from "./wallet.math.ts";

@Injectable()
export class WalletService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: number): Promise<WalletResponseDto> {
    const existing = await this.prisma.client.orm.public.Wallet.where({
      userId,
    }).first();
    if (existing) {
      return this.toWalletDto(existing);
    }

    const created = await this.prisma.client.orm.public.Wallet.create({
      userId,
      balanceUsd: "0",
      vaultUsd: "0",
      currency: "USD",
    });
    return this.toWalletDto(created);
  }

  async getBalance(userId: number): Promise<WalletResponseDto> {
    return this.getOrCreateWallet(userId);
  }

  async listTransactions(userId: number, page = 1, limit = 50) {
    const wallet = await this.getOrCreateWallet(userId);
    const offset = (page - 1) * limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.WalletTransaction.where({
        walletId: wallet.id,
      }).aggregate((a) => ({ count: a.count() })),
      this.prisma.client.orm.public.WalletTransaction.where({
        walletId: wallet.id,
      })
        .orderBy((tx) => tx.createdAt.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    const total = Number(agg.count ?? 0);
    return {
      items: rows.map((row) => this.toTxDto(row)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Stake-style totals: wagered volume + net game P/L.
   *
   * Color: wagered = bet stake.
   * Card games: hand start debits the full stack as a reserve (not a wager).
   * Pair reserve debit + return credit by handId; wagered = |debit − credit|
   * (actual chips won/lost that hand), not the reserved stack.
   */
  async getStats(userId: number) {
    const wallet = await this.getOrCreateWallet(userId);
    const rows = await this.prisma.client.orm.public.WalletTransaction.where({
      walletId: wallet.id,
    }).all();

    const handDebitTypes = new Set<string>([
      WALLET_TX_TYPE.DEBIT_POKER_HAND,
      WALLET_TX_TYPE.DEBIT_TEEN_HAND,
      WALLET_TX_TYPE.DEBIT_RUMMY_HAND,
    ]);
    const handCreditTypes = new Set<string>([
      WALLET_TX_TYPE.CREDIT_POKER_HAND,
      WALLET_TX_TYPE.CREDIT_TEEN_HAND,
      WALLET_TX_TYPE.CREDIT_RUMMY_HAND,
    ]);
    /** Legacy sit escrow — counts toward P/L only, not wagered. */
    const legacyDebitTypes = new Set<string>([
      WALLET_TX_TYPE.DEBIT_POKER_BUYIN,
      WALLET_TX_TYPE.DEBIT_TEEN_BUYIN,
      WALLET_TX_TYPE.DEBIT_RUMMY_BUYIN,
    ]);
    const legacyCreditTypes = new Set<string>([
      WALLET_TX_TYPE.CREDIT_POKER_CASHOUT,
      WALLET_TX_TYPE.CREDIT_TEEN_CASHOUT,
      WALLET_TX_TYPE.CREDIT_RUMMY_CASHOUT,
    ]);

    let wagered = 0;
    let gameIn = 0;
    let gameOut = 0;
    const hands = new Map<string, { debit: number; credit: number }>();

    for (const row of rows) {
      const amt = Number(row.amountUsd);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      if (row.type === WALLET_TX_TYPE.DEBIT_COLOR_BET) {
        wagered += amt;
        gameOut += amt;
        continue;
      }
      if (
        row.type === WALLET_TX_TYPE.CREDIT_COLOR_WIN ||
        row.type === WALLET_TX_TYPE.CREDIT_COLOR_REFUND
      ) {
        gameIn += amt;
        continue;
      }

      if (handDebitTypes.has(row.type)) {
        const key = `${row.referenceType ?? "hand"}:${row.referenceId ?? row.id}`;
        const bucket = hands.get(key) ?? { debit: 0, credit: 0 };
        bucket.debit += amt;
        hands.set(key, bucket);
        continue;
      }
      if (handCreditTypes.has(row.type)) {
        const key = `${row.referenceType ?? "hand"}:${row.referenceId ?? row.id}`;
        const bucket = hands.get(key) ?? { debit: 0, credit: 0 };
        bucket.credit += amt;
        hands.set(key, bucket);
        continue;
      }

      if (legacyDebitTypes.has(row.type)) {
        gameOut += amt;
        continue;
      }
      if (legacyCreditTypes.has(row.type)) {
        gameIn += amt;
      }
    }

    for (const hand of hands.values()) {
      // Ignore open hands (reserve debit with no return yet) — would look like
      // a full-stack loss/wager while the hand is still running.
      if (hand.credit <= 0 && hand.debit > 0) continue;
      gameOut += hand.debit;
      gameIn += hand.credit;
      // Chips that actually moved vs the reserved stack (won or lost).
      wagered += Math.abs(hand.debit - hand.credit);
    }

    return {
      totalWageredUsd: normalizeUsd(wagered),
      profitLossUsd: normalizeUsd(gameIn - gameOut),
      balanceUsd: wallet.balanceUsd,
      vaultUsd: wallet.vaultUsd,
    };
  }

  /** Lock spendable balance into the vault (cannot bet from vault). */
  async depositToVault(userId: number, amountUsd: number | string) {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({ userId }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      const amount = normalizeUsd(amountUsd);
      if (Number(amount) <= 0) {
        throw new BadRequestException("Amount must be positive");
      }
      if (!gteUsd(wallet.balanceUsd, amount)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceAfter = subUsd(wallet.balanceUsd, amount);
      const vaultAfter = addUsd(wallet.vaultUsd ?? "0", amount);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
        vaultUsd: vaultAfter,
      });
      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_VAULT_DEPOSIT,
        amountUsd: amount,
        balanceAfter,
        referenceType: "vault",
        referenceId: wallet.id,
        description: `Vault deposit ${amount} USD`,
      });

      return this.toWalletDto({
        ...wallet,
        balanceUsd: balanceAfter,
        vaultUsd: vaultAfter,
      });
    });
  }

  /** Move funds from vault back to spendable wallet. */
  async withdrawFromVault(userId: number, amountUsd: number | string) {
    return this.prisma.client.transaction(async (tx) => {
      const wallet = await tx.orm.public.Wallet.where({ userId }).first();
      if (!wallet) {
        throw new BadRequestException("Wallet not found");
      }

      const amount = normalizeUsd(amountUsd);
      if (Number(amount) <= 0) {
        throw new BadRequestException("Amount must be positive");
      }
      const vaultBal = wallet.vaultUsd ?? "0";
      if (!gteUsd(vaultBal, amount)) {
        throw new BadRequestException("Insufficient vault balance");
      }

      const balanceAfter = addUsd(wallet.balanceUsd, amount);
      const vaultAfter = subUsd(vaultBal, amount);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
        vaultUsd: vaultAfter,
      });
      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_VAULT_WITHDRAW,
        amountUsd: amount,
        balanceAfter,
        referenceType: "vault",
        referenceId: wallet.id,
        description: `Vault withdraw ${amount} USD`,
      });

      return this.toWalletDto({
        ...wallet,
        balanceUsd: balanceAfter,
        vaultUsd: vaultAfter,
      });
    });
  }

  /** Credits wallet from a paid USD top-up. Idempotent via payment.walletCredited. */
  async creditFromTopupPayment(paymentId: number): Promise<void> {
    await this.prisma.client.transaction(async (tx) => {
      const payment = await tx.orm.public.Payment.where({ id: paymentId }).first();
      if (!payment) {
        throw new NotFoundException(`Payment ${paymentId} not found`);
      }
      if (payment.walletCredited) {
        return;
      }
      if (payment.currency.toUpperCase() !== "USD") {
        throw new BadRequestException("Only USD top-ups can credit the wallet");
      }

      let wallet = await tx.orm.public.Wallet.where({
        userId: payment.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: payment.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(payment.amount);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);

      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_TOPUP,
        amountUsd: credit,
        balanceAfter,
        referenceType: "payment",
        referenceId: payment.id,
        description: `Top-up via OxaPay (${payment.orderId})`,
      });

      await tx.orm.public.Payment.where({ id: payment.id }).update({
        walletCredited: true,
      });
    });
  }

  /** Debits wallet for a payout request. Returns new balance. */
  async debitForPayout(input: {
    userId: number;
    amountUsd: string | number;
    payoutId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceAfter = subUsd(wallet.balanceUsd, debit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_PAYOUT,
        amountUsd: debit,
        balanceAfter,
        referenceType: "payout",
        referenceId: input.payoutId,
        description: input.description ?? `Payout #${input.payoutId}`,
      });

      return balanceAfter;
    });
  }

  async debitForPokerBuyIn(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceAfter = subUsd(wallet.balanceUsd, debit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_POKER_BUYIN,
        amountUsd: debit,
        balanceAfter,
        referenceType: "poker_seat",
        referenceId: input.seatId,
        description: input.description ?? `Poker buy-in seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  async creditPokerCashout(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_POKER_CASHOUT,
        amountUsd: credit,
        balanceAfter,
        referenceType: "poker_seat",
        referenceId: input.seatId,
        description:
          input.description ?? `Poker cash-out seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  async debitForTeenBuyIn(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({ userId: input.userId }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceAfter = subUsd(wallet.balanceUsd, debit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({ balanceUsd: balanceAfter });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_TEEN_BUYIN,
        amountUsd: debit,
        balanceAfter,
        referenceType: "teen_seat",
        referenceId: input.seatId,
        description: input.description ?? `Teen Patti buy-in seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  async creditTeenCashout(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({ userId: input.userId }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({ balanceUsd: balanceAfter });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_TEEN_CASHOUT,
        amountUsd: credit,
        balanceAfter,
        referenceType: "teen_seat",
        referenceId: input.seatId,
        description: input.description ?? `Teen Patti cash-out seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  async debitForRummyBuyIn(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({ userId: input.userId }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceAfter = subUsd(wallet.balanceUsd, debit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({ balanceUsd: balanceAfter });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_RUMMY_BUYIN,
        amountUsd: debit,
        balanceAfter,
        referenceType: "rummy_seat",
        referenceId: input.seatId,
        description: input.description ?? `Rummy buy-in seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  async creditRummyCashout(input: {
    userId: number;
    amountUsd: string | number;
    seatId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({ userId: input.userId }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({ balanceUsd: balanceAfter });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_RUMMY_CASHOUT,
        amountUsd: credit,
        balanceAfter,
        referenceType: "rummy_seat",
        referenceId: input.seatId,
        description: input.description ?? `Rummy cash-out seat #${input.seatId}`,
      });

      return balanceAfter;
    });
  }

  /**
   * Reserve stack for a card-game hand (same idea as a color bet debit).
   * Money leaves the wallet while the hand runs; ending stack is credited back.
   */
  async debitForCardHand(input: {
    userId: number;
    amountUsd: string | number;
    game: "poker" | "teen" | "rummy";
    handId: number;
    description?: string;
  }): Promise<string> {
    const type =
      input.game === "poker"
        ? WALLET_TX_TYPE.DEBIT_POKER_HAND
        : input.game === "teen"
          ? WALLET_TX_TYPE.DEBIT_TEEN_HAND
          : WALLET_TX_TYPE.DEBIT_RUMMY_HAND;
    const label =
      input.game === "poker"
        ? "Poker"
        : input.game === "teen"
          ? "Teen Patti"
          : "Rummy";

    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (Number(debit) <= 0) return normalizeUsd(wallet.balanceUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const expectedBalance = wallet.balanceUsd;
      const balanceAfter = subUsd(expectedBalance, debit);
      await tx.orm.public.Wallet.where({
        id: wallet.id,
        balanceUsd: expectedBalance,
      }).update({
        balanceUsd: balanceAfter,
      });
      const verify = await tx.orm.public.Wallet.where({ id: wallet.id }).first();
      if (!verify || verify.balanceUsd !== balanceAfter) {
        throw new BadRequestException(
          "Balance changed while reserving hand — try again",
        );
      }

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type,
        amountUsd: debit,
        balanceAfter,
        referenceType: `${input.game}_hand`,
        referenceId: input.handId,
        description:
          input.description ?? `${label} hand #${input.handId} reserve`,
      });

      return balanceAfter;
    });
  }

  /**
   * Refund any unpaired card-hand reserves for a cancelled/orphaned hand
   * (debit − already-credited return). Safe to call more than once.
   */
  async refundOutstandingCardHand(input: {
    game: "poker" | "teen" | "rummy";
    handId: number;
  }): Promise<void> {
    const debitType =
      input.game === "poker"
        ? WALLET_TX_TYPE.DEBIT_POKER_HAND
        : input.game === "teen"
          ? WALLET_TX_TYPE.DEBIT_TEEN_HAND
          : WALLET_TX_TYPE.DEBIT_RUMMY_HAND;
    const creditType =
      input.game === "poker"
        ? WALLET_TX_TYPE.CREDIT_POKER_HAND
        : input.game === "teen"
          ? WALLET_TX_TYPE.CREDIT_TEEN_HAND
          : WALLET_TX_TYPE.CREDIT_RUMMY_HAND;
    const refType = `${input.game}_hand`;

    const txs = await this.prisma.client.orm.public.WalletTransaction.where({
      referenceType: refType,
      referenceId: input.handId,
    }).all();

    const byWallet = new Map<
      number,
      { userId: number; debit: number; credit: number }
    >();
    for (const tx of txs) {
      const wallet = await this.prisma.client.orm.public.Wallet.where({
        id: tx.walletId,
      }).first();
      if (!wallet) continue;
      const bucket = byWallet.get(tx.walletId) ?? {
        userId: wallet.userId,
        debit: 0,
        credit: 0,
      };
      const amt = Number(tx.amountUsd);
      if (tx.type === debitType) bucket.debit += amt;
      if (tx.type === creditType) bucket.credit += amt;
      byWallet.set(tx.walletId, bucket);
    }

    for (const bucket of byWallet.values()) {
      const outstanding = bucket.debit - bucket.credit;
      if (outstanding > 1e-8) {
        await this.creditFromCardHand({
          userId: bucket.userId,
          amountUsd: outstanding,
          game: input.game,
          handId: input.handId,
          description: `${input.game} hand #${input.handId} orphan refund`,
        });
      }
    }
  }

  /**
   * Credit until this wallet's total CREDIT for the hand reaches `targetUsd`.
   * Safe to retry (settle resume). Does not refund if already over target.
   */
  async creditCardHandUpToTarget(input: {
    userId: number;
    targetUsd: string | number;
    game: "poker" | "teen" | "rummy";
    handId: number;
    description?: string;
  }): Promise<string> {
    const creditType =
      input.game === "poker"
        ? WALLET_TX_TYPE.CREDIT_POKER_HAND
        : input.game === "teen"
          ? WALLET_TX_TYPE.CREDIT_TEEN_HAND
          : WALLET_TX_TYPE.CREDIT_RUMMY_HAND;
    const refType = `${input.game}_hand`;
    const wallet = await this.getOrCreateWallet(input.userId);
    const txs = await this.prisma.client.orm.public.WalletTransaction.where({
      referenceType: refType,
      referenceId: input.handId,
      walletId: wallet.id,
    }).all();
    let credited = 0;
    for (const tx of txs) {
      if (tx.type === creditType) credited += Number(tx.amountUsd);
    }
    const target = Number(normalizeUsd(input.targetUsd));
    const gap = target - credited;
    if (gap <= 1e-8) {
      return normalizeUsd(wallet.balanceUsd);
    }
    return this.creditFromCardHand({
      userId: input.userId,
      amountUsd: gap,
      game: input.game,
      handId: input.handId,
      description:
        input.description ??
        `${input.game} hand #${input.handId} settle`,
    });
  }

  /** Return / pay out ending stack after a card-game hand (like a color win credit). */
  async creditFromCardHand(input: {
    userId: number;
    amountUsd: string | number;
    game: "poker" | "teen" | "rummy";
    handId: number;
    description?: string;
  }): Promise<string> {
    const type =
      input.game === "poker"
        ? WALLET_TX_TYPE.CREDIT_POKER_HAND
        : input.game === "teen"
          ? WALLET_TX_TYPE.CREDIT_TEEN_HAND
          : WALLET_TX_TYPE.CREDIT_RUMMY_HAND;
    const label =
      input.game === "poker"
        ? "Poker"
        : input.game === "teen"
          ? "Teen Patti"
          : "Rummy";

    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(input.amountUsd);
      if (Number(credit) <= 0) return normalizeUsd(wallet.balanceUsd);

      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type,
        amountUsd: credit,
        balanceAfter,
        referenceType: `${input.game}_hand`,
        referenceId: input.handId,
        description:
          input.description ?? `${label} hand #${input.handId} return`,
      });

      return balanceAfter;
    });
  }

  async debitForColorBet(input: {
    userId: number;
    amountUsd: string | number;
    betId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const debit = normalizeUsd(input.amountUsd);
      if (!gteUsd(wallet.balanceUsd, debit)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const expectedBalance = wallet.balanceUsd;
      const balanceAfter = subUsd(expectedBalance, debit);
      // Optimistic lock: fail if another debit changed the balance mid-flight.
      await tx.orm.public.Wallet.where({
        id: wallet.id,
        balanceUsd: expectedBalance,
      }).update({
        balanceUsd: balanceAfter,
      });
      const verify = await tx.orm.public.Wallet.where({ id: wallet.id }).first();
      if (!verify || verify.balanceUsd !== balanceAfter) {
        throw new BadRequestException(
          "Balance changed while placing bet — try again",
        );
      }

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_COLOR_BET,
        amountUsd: debit,
        balanceAfter,
        referenceType: "color_bet",
        referenceId: input.betId,
        description: input.description ?? `Color bet #${input.betId}`,
      });

      return balanceAfter;
    });
  }

  /**
   * Create a color bet and debit the wallet in one transaction so a full-balance
   * bet cannot leave an unpaid pending row when the debit races.
   */
  async createColorBetAndDebit(input: {
    userId: number;
    roundId: number;
    betType: string;
    selection: string;
    amountUsd: string | number;
    description?: string;
  }): Promise<{
    id: number;
    roundId: number;
    userId: number;
    betType: string;
    selection: string;
    amountUsd: string;
    payoutUsd: string;
    status: string;
    balanceAfter: string;
  }> {
    const amount = normalizeUsd(input.amountUsd);
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      if (!gteUsd(wallet.balanceUsd, amount)) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const expectedBalance = wallet.balanceUsd;
      const balanceAfter = subUsd(expectedBalance, amount);

      const bet = await tx.orm.public.ColorBet.create({
        roundId: input.roundId,
        userId: input.userId,
        betType: input.betType,
        selection: input.selection,
        amountUsd: amount,
        payoutUsd: "0",
        status: "pending",
      });

      await tx.orm.public.Wallet.where({
        id: wallet.id,
        balanceUsd: expectedBalance,
      }).update({
        balanceUsd: balanceAfter,
      });
      const verify = await tx.orm.public.Wallet.where({ id: wallet.id }).first();
      if (!verify || verify.balanceUsd !== balanceAfter) {
        throw new BadRequestException(
          "Balance changed while placing bet — try again",
        );
      }

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.DEBIT_COLOR_BET,
        amountUsd: amount,
        balanceAfter,
        referenceType: "color_bet",
        referenceId: bet.id,
        description:
          input.description ?? `Color bet #${bet.id}`,
      });

      return {
        id: bet.id,
        roundId: bet.roundId,
        userId: bet.userId,
        betType: bet.betType,
        selection: bet.selection,
        amountUsd: bet.amountUsd,
        payoutUsd: bet.payoutUsd,
        status: bet.status,
        balanceAfter,
      };
    });
  }

  async creditColorWin(input: {
    userId: number;
    amountUsd: string | number;
    betId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      // Idempotent: skip if this bet was already paid.
      const existing = await tx.orm.public.WalletTransaction.where({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_COLOR_WIN,
        referenceType: "color_bet",
        referenceId: input.betId,
      }).first();
      if (existing) {
        return normalizeUsd(wallet.balanceUsd);
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_COLOR_WIN,
        amountUsd: credit,
        balanceAfter,
        referenceType: "color_bet",
        referenceId: input.betId,
        description: input.description ?? `Color win #${input.betId}`,
      });

      return balanceAfter;
    });
  }

  async creditColorRefund(input: {
    userId: number;
    amountUsd: string | number;
    betId: number;
    description?: string;
  }): Promise<string> {
    return this.prisma.client.transaction(async (tx) => {
      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          vaultUsd: "0",
          currency: "USD",
        });
      }

      // Idempotent refund if this bet was already refunded.
      const existing = await tx.orm.public.WalletTransaction.where({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_COLOR_REFUND,
        referenceType: "color_bet",
        referenceId: input.betId,
      }).first();
      if (existing) {
        return normalizeUsd(wallet.balanceUsd);
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);
      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_COLOR_REFUND,
        amountUsd: credit,
        balanceAfter,
        referenceType: "color_bet",
        referenceId: input.betId,
        description: input.description ?? `Color refund #${input.betId}`,
      });

      return balanceAfter;
    });
  }

  /** Refunds a failed payout back to the wallet. Idempotent by checking existing refund tx. */
  async refundFailedPayout(input: {
    userId: number;
    amountUsd: string | number;
    payoutId: number;
  }): Promise<void> {
    await this.prisma.client.transaction(async (tx) => {
      const existing = await tx.orm.public.WalletTransaction.where({
        referenceType: "payout",
        referenceId: input.payoutId,
        type: WALLET_TX_TYPE.CREDIT_PAYOUT_REFUND,
      }).first();
      if (existing) {
        return;
      }

      let wallet = await tx.orm.public.Wallet.where({
        userId: input.userId,
      }).first();
      if (!wallet) {
        wallet = await tx.orm.public.Wallet.create({
          userId: input.userId,
          balanceUsd: "0",
          currency: "USD",
        });
      }

      const credit = normalizeUsd(input.amountUsd);
      const balanceAfter = addUsd(wallet.balanceUsd, credit);

      await tx.orm.public.Wallet.where({ id: wallet.id }).update({
        balanceUsd: balanceAfter,
      });

      await tx.orm.public.WalletTransaction.create({
        walletId: wallet.id,
        type: WALLET_TX_TYPE.CREDIT_PAYOUT_REFUND,
        amountUsd: credit,
        balanceAfter,
        referenceType: "payout",
        referenceId: input.payoutId,
        description: `Refund for failed payout #${input.payoutId}`,
      });
    });
  }

  private toWalletDto(row: {
    id: number;
    userId: number;
    balanceUsd: string | number;
    vaultUsd?: string | number | null;
    currency: string;
    updatedAt: string;
  }): WalletResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      balanceUsd: normalizeUsd(row.balanceUsd),
      vaultUsd: normalizeUsd(row.vaultUsd ?? 0),
      currency: row.currency,
      updatedAt: row.updatedAt,
    };
  }

  private toTxDto(row: {
    id: number;
    type: string;
    amountUsd: string | number;
    balanceAfter: string | number;
    referenceType: string | null;
    referenceId: number | null;
    description: string | null;
    createdAt: string;
  }): WalletTransactionDto {
    return {
      id: row.id,
      type: row.type,
      amountUsd: normalizeUsd(row.amountUsd),
      balanceAfter: normalizeUsd(row.balanceAfter),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      createdAt: row.createdAt,
    };
  }
}
