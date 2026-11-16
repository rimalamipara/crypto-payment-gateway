import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import { PAYMENT_STATUS } from "./constants/payment-status.ts";
import type { PaymentResponseDto } from "./dto/payment-response.dto.ts";

export interface CreatePaymentRecordInput {
  orderId: string;
  userId: number;
  amount: string;
  currency: string;
  purpose?: string;
  description?: string | null;
  email?: string | null;
  returnUrl?: string | null;
  status?: string;
  trackId?: string | null;
  paymentUrl?: string | null;
  expiresAt?: string | null;
}

export interface UpdatePaymentFromGatewayInput {
  status: string;
  trackId?: string | null;
  paymentUrl?: string | null;
  expiresAt?: string | null;
  paidCurrency?: string | null;
  paidAmount?: string | null;
  txHash?: string | null;
  webhookPayload?: string | null;
  paidAt?: string | null;
}

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreatePaymentRecordInput): Promise<PaymentResponseDto> {
    const created = await this.prisma.client.orm.public.Payment.create({
      orderId: input.orderId,
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      purpose: input.purpose ?? "topup",
      status: input.status ?? PAYMENT_STATUS.NEW,
      description: input.description ?? null,
      email: input.email ?? null,
      returnUrl: input.returnUrl ?? null,
      trackId: input.trackId ?? null,
      paymentUrl: input.paymentUrl ?? null,
      expiresAt: input.expiresAt ?? null,
      paidCurrency: null,
      paidAmount: null,
      txHash: null,
      webhookPayload: null,
      walletCredited: false,
      paidAt: null,
    });

    return this.toDto(created);
  }

  async findById(id: number): Promise<PaymentResponseDto | null> {
    const payment = await this.prisma.client.orm.public.Payment.where({ id }).first();
    return payment ? this.toDto(payment) : null;
  }

  async findByOrderId(orderId: string): Promise<PaymentResponseDto | null> {
    const payment = await this.prisma.client.orm.public.Payment.where({
      orderId,
    }).first();
    return payment ? this.toDto(payment) : null;
  }

  async findByTrackId(trackId: string): Promise<PaymentResponseDto | null> {
    const payment = await this.prisma.client.orm.public.Payment.where({
      trackId,
    }).first();
    return payment ? this.toDto(payment) : null;
  }

  async findByUserIdPage(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ items: PaymentResponseDto[]; total: number }> {
    const offset = (page - 1) * limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.Payment.where({ userId }).aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.Payment.where({ userId })
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
  ): Promise<{ items: PaymentResponseDto[]; total: number }> {
    const offset = (page - 1) * limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.Payment.aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.Payment.orderBy((p) => p.createdAt.desc())
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
    input: UpdatePaymentFromGatewayInput,
  ): Promise<PaymentResponseDto> {
    await this.prisma.client.orm.public.Payment.where({ id }).update({
      status: input.status,
      ...(input.trackId !== undefined ? { trackId: input.trackId } : {}),
      ...(input.paymentUrl !== undefined ? { paymentUrl: input.paymentUrl } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.paidCurrency !== undefined
        ? { paidCurrency: input.paidCurrency }
        : {}),
      ...(input.paidAmount !== undefined ? { paidAmount: input.paidAmount } : {}),
      ...(input.txHash !== undefined ? { txHash: input.txHash } : {}),
      ...(input.webhookPayload !== undefined
        ? { webhookPayload: input.webhookPayload }
        : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : {}),
    });

    const payment = await this.findById(id);
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }

  private toDto(row: {
    id: number;
    orderId: string;
    userId: number;
    amount: string | number;
    currency: string;
    purpose: string;
    status: string;
    walletCredited: boolean;
    trackId: string | null;
    paymentUrl: string | null;
    description: string | null;
    email: string | null;
    returnUrl: string | null;
    paidCurrency: string | null;
    paidAmount: string | null;
    txHash: string | null;
    expiresAt: string | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): PaymentResponseDto {
    return {
      id: row.id,
      orderId: row.orderId,
      userId: row.userId,
      amount: normalizeUsd(row.amount),
      currency: row.currency,
      purpose: row.purpose,
      status: row.status,
      walletCredited: row.walletCredited,
      trackId: row.trackId,
      paymentUrl: row.paymentUrl,
      description: row.description,
      email: row.email,
      returnUrl: row.returnUrl,
      paidCurrency: row.paidCurrency,
      paidAmount: row.paidAmount,
      txHash: row.txHash,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
