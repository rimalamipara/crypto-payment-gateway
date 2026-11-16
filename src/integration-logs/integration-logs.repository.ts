import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";

export interface CreateApiRequestLogInput {
  direction: "inbound" | "outbound";
  source: string;
  method: string;
  path: string;
  url?: string | null;
  requestHeaders?: string | null;
  requestBody?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  ip?: string | null;
  userId?: number | null;
  trackId?: string | null;
  orderId?: string | null;
  durationMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
}

export interface CreateWebhookLogInput {
  source?: string;
  channel: string;
  method?: string;
  path: string;
  requestHeaders?: string | null;
  requestBody?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  hmacHeader?: string | null;
  signatureValid?: boolean | null;
  trackId?: string | null;
  orderId?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  success?: boolean;
  errorMessage?: string | null;
}

export interface ApiRequestLogRow {
  id: number;
  direction: string;
  source: string;
  method: string;
  path: string;
  url: string | null;
  requestHeaders: string | null;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  ip: string | null;
  userId: number | null;
  trackId: string | null;
  orderId: string | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookLogRow {
  id: number;
  source: string;
  channel: string;
  method: string;
  path: string;
  requestHeaders: string | null;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  hmacHeader: string | null;
  signatureValid: boolean | null;
  trackId: string | null;
  orderId: string | null;
  relatedType: string | null;
  relatedId: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

@Injectable()
export class IntegrationLogsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createApiRequest(
    input: CreateApiRequestLogInput,
  ): Promise<ApiRequestLogRow> {
    const row = await this.prisma.client.orm.public.ApiRequestLog.create({
      direction: input.direction,
      source: input.source,
      method: input.method,
      path: input.path,
      url: input.url ?? null,
      requestHeaders: input.requestHeaders ?? null,
      requestBody: input.requestBody ?? null,
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      ip: input.ip ?? null,
      userId: input.userId ?? null,
      trackId: input.trackId ?? null,
      orderId: input.orderId ?? null,
      durationMs: input.durationMs ?? null,
      success: input.success ?? true,
      errorMessage: input.errorMessage ?? null,
    });
    return this.toApiRow(row);
  }

  async createWebhook(input: CreateWebhookLogInput): Promise<WebhookLogRow> {
    const row = await this.prisma.client.orm.public.WebhookLog.create({
      source: input.source ?? "oxapay",
      channel: input.channel,
      method: input.method ?? "POST",
      path: input.path,
      requestHeaders: input.requestHeaders ?? null,
      requestBody: input.requestBody ?? null,
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      hmacHeader: input.hmacHeader ?? null,
      signatureValid: input.signatureValid ?? null,
      trackId: input.trackId ?? null,
      orderId: input.orderId ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      success: input.success ?? true,
      errorMessage: input.errorMessage ?? null,
    });
    return this.toWebhookRow(row);
  }

  async findApiRequests(opts: {
    page: number;
    limit: number;
  }): Promise<{ items: ApiRequestLogRow[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.ApiRequestLog.aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.ApiRequestLog.select(
        "id",
        "direction",
        "source",
        "method",
        "path",
        "url",
        "requestHeaders",
        "requestBody",
        "responseStatus",
        "responseBody",
        "ip",
        "userId",
        "trackId",
        "orderId",
        "durationMs",
        "success",
        "errorMessage",
        "createdAt",
      )
        .orderBy((row) => row.id.desc())
        .offset(offset)
        .limit(opts.limit)
        .all(),
    ]);
    return {
      items: rows.map((row) => this.toApiRow(row)),
      total: Number(agg.count ?? 0),
    };
  }

  async findWebhooks(opts: {
    page: number;
    limit: number;
  }): Promise<{ items: WebhookLogRow[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const [agg, rows] = await Promise.all([
      this.prisma.client.orm.public.WebhookLog.aggregate((a) => ({
        count: a.count(),
      })),
      this.prisma.client.orm.public.WebhookLog.select(
        "id",
        "source",
        "channel",
        "method",
        "path",
        "requestHeaders",
        "requestBody",
        "responseStatus",
        "responseBody",
        "hmacHeader",
        "signatureValid",
        "trackId",
        "orderId",
        "relatedType",
        "relatedId",
        "success",
        "errorMessage",
        "createdAt",
      )
        .orderBy((row) => row.id.desc())
        .offset(offset)
        .limit(opts.limit)
        .all(),
    ]);
    return {
      items: rows.map((row) => this.toWebhookRow(row)),
      total: Number(agg.count ?? 0),
    };
  }

  private toApiRow(row: ApiRequestLogRow): ApiRequestLogRow {
    return { ...row };
  }

  private toWebhookRow(row: WebhookLogRow): WebhookLogRow {
    return { ...row };
  }
}
