import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  IntegrationLogsRepository,
  type ApiRequestLogRow,
  type CreateApiRequestLogInput,
  type CreateWebhookLogInput,
  type WebhookLogRow,
} from "./integration-logs.repository.ts";

@Injectable()
export class IntegrationLogsService {
  private readonly logger = new Logger(IntegrationLogsService.name);

  constructor(
    @Inject(IntegrationLogsRepository)
    private readonly repository: IntegrationLogsRepository,
  ) {}

  /** Fire-and-forget API log; never throws into callers. */
  recordApi(input: CreateApiRequestLogInput): void {
    void this.repository.createApiRequest(input).catch((error: unknown) => {
      this.logger.warn(
        `Failed to persist API request log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /** Fire-and-forget webhook log; never throws into callers. */
  recordWebhook(input: CreateWebhookLogInput): void {
    void this.repository.createWebhook(input).catch((error: unknown) => {
      this.logger.warn(
        `Failed to persist webhook log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async listApiRequests(page = 1, limit = 50): Promise<{
    items: ApiRequestLogRow[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const result = await this.repository.findApiRequests({ page, limit });
    return {
      items: result.items,
      page,
      limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / limit)),
    };
  }

  async listWebhooks(page = 1, limit = 50): Promise<{
    items: WebhookLogRow[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const result = await this.repository.findWebhooks({ page, limit });
    return {
      items: result.items,
      page,
      limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / limit)),
    };
  }

  static safeJson(value: unknown): string | null {
    if (value === undefined) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  static truncate(value: string | null, max = 50_000): string | null {
    if (!value) return value;
    if (value.length <= max) return value;
    return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
  }

  static redactHeaders(
    headers: Record<string, string | string[] | undefined> | undefined,
  ): string | null {
    if (!headers) return null;
    const redacted: Record<string, string> = {};
    for (const [key, raw] of Object.entries(headers)) {
      const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
      const lower = key.toLowerCase();
      if (
        lower.includes("api_key") ||
        lower.includes("apikey") ||
        lower.includes("authorization") ||
        lower === "cookie" ||
        lower === "hmac"
      ) {
        redacted[key] = value ? `${String(value).slice(0, 6)}…(redacted)` : "";
      } else {
        redacted[key] = String(value);
      }
    }
    return JSON.stringify(redacted);
  }

  static extractTrackId(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const record = body as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    const track =
      record.track_id ??
      record.trackId ??
      data?.track_id ??
      data?.trackId;
    return typeof track === "string" ? track : null;
  }

  static extractOrderId(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const record = body as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    const order =
      record.order_id ??
      record.orderId ??
      data?.order_id ??
      data?.orderId;
    return typeof order === "string" ? order : null;
  }
}
