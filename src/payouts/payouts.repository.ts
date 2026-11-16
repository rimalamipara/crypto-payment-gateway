import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { PAYOUT_STATUS } from "./constants/payout-status.ts";
import type { PayoutResponseDto } from "./dto/payout-response.dto.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";

@Injectable()
export class PayoutsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    userId: number;
    amountUsd: string;
    currency: string;
    network?: string | null;
    address: string;
    status?: string;
    memo?: string | null;
    description?: string | null;
  }): Promise<PayoutResponseDto> {
    const created = await this.prisma.client.orm.public.Payout.create({
      userId: input.userId,
      amountUsd: input.amountUsd,
      currency: input.currency,
      network: input.network ?? null,
      address: input.address,
      status: input.status ?? PAYOUT_STATUS.PENDING,
      trackId: null,
      txHash: null,
      fee: null,
      memo: input.memo ?? null,
      description: input.description ?? null,
      webhookPayload: null,
    });
    return this.toDto(created);
  }

  async findById(id: number): Promise<PayoutResponseDto | null> {
    const row = await this.prisma.client.orm.public.Payout.where({ id }).first();
    return row ? this.toDto(row) : null;
  }

  async findByTrackId(trackId: string): Promise<PayoutResponseDto | null> {
    const row = await this.prisma.client.orm.public.Payout.where({
      trackId,
    }).first();
    return row ? this.toDto(row) : null;
  }

  async findByUserIdPage(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ items: PayoutResponseDto[]; total: number }> {
    const offset = (page - 1) * limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.Payout.where({ userId }).aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.Payout.where({ userId })
        .orderBy((p) => p.createdAt.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      total: Number(agg.count ?? 0),
    };
  }

  async findAllPage(
    page: number,
    limit: number,
  ): Promise<{ items: PayoutResponseDto[]; total: number }> {
    const offset = (page - 1) * limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.Payout.aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.Payout.orderBy((p) => p.createdAt.desc())
        .offset(offset)
        .limit(limit)
        .all(),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      total: Number(agg.count ?? 0),
    };
  }

  async updateById(
    id: number,
    patch: {
      status?: string;
      trackId?: string | null;
      txHash?: string | null;
      fee?: string | null;
      webhookPayload?: string | null;
    },
  ): Promise<PayoutResponseDto> {
    await this.prisma.client.orm.public.Payout.where({ id }).update({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.trackId !== undefined ? { trackId: patch.trackId } : {}),
      ...(patch.txHash !== undefined ? { txHash: patch.txHash } : {}),
      ...(patch.fee !== undefined ? { fee: patch.fee } : {}),
      ...(patch.webhookPayload !== undefined
        ? { webhookPayload: patch.webhookPayload }
        : {}),
    });
    const row = await this.findById(id);
    if (!row) {
      throw new NotFoundException(`Payout ${id} not found`);
    }
    return row;
  }

  private toDto(row: {
    id: number;
    userId: number;
    amountUsd: string | number;
    currency: string;
    network: string | null;
    address: string;
    status: string;
    trackId: string | null;
    txHash: string | null;
    fee: string | null;
    memo: string | null;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }): PayoutResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      amountUsd: normalizeUsd(row.amountUsd),
      currency: row.currency,
      network: row.network,
      address: row.address,
      status: row.status,
      trackId: row.trackId,
      txHash: row.txHash,
      fee: row.fee,
      memo: row.memo,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
