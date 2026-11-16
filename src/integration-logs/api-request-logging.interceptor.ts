import { Inject, Injectable } from "@nestjs/common";
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, catchError, tap, throwError } from "rxjs";

import { IntegrationLogsService } from "./integration-logs.service.ts";

const SKIP_PREFIXES = ["/docs", "/favicon", "/admin/integration-logs"];

@Injectable()
export class ApiRequestLoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(IntegrationLogsService)
    private readonly integrationLogs: IntegrationLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<
      Request & { user?: { id?: number }; rawBody?: Buffer }
    >();
    const res = http.getResponse<Response>();
    const path = (req.originalUrl || req.url || "").split("?")[0];

    // Webhooks are stored in WebhookLog by their handlers.
    if (path.endsWith("/webhook") || path.includes("/webhook")) {
      return next.handle();
    }
    if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next.handle();
    }

    const started = Date.now();
    const method = req.method;
    const body =
      req.rawBody?.toString("utf8") ??
      (req.body !== undefined
        ? IntegrationLogsService.safeJson(req.body)
        : null);

    const finish = (opts: {
      success: boolean;
      responseBody?: unknown;
      errorMessage?: string | null;
    }) => {
      this.integrationLogs.recordApi({
        direction: "inbound",
        source: "gateway",
        method,
        path,
        url: `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl || req.url}`,
        requestHeaders: IntegrationLogsService.redactHeaders(
          req.headers as Record<string, string | string[] | undefined>,
        ),
        requestBody: IntegrationLogsService.truncate(body),
        responseStatus: res.statusCode,
        responseBody: IntegrationLogsService.truncate(
          IntegrationLogsService.safeJson(opts.responseBody),
        ),
        ip: req.ip ?? req.socket.remoteAddress ?? null,
        userId: req.user?.id ?? null,
        trackId: IntegrationLogsService.extractTrackId(req.body),
        orderId: IntegrationLogsService.extractOrderId(req.body),
        durationMs: Date.now() - started,
        success: opts.success,
        errorMessage: opts.errorMessage ?? null,
      });
    };

    return next.handle().pipe(
      tap((data) => {
        finish({ success: res.statusCode < 400, responseBody: data });
      }),
      catchError((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Request failed";
        const status =
          typeof error === "object" &&
          error &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
            ? (error as { status: number }).status
            : res.statusCode || 500;
        res.statusCode = status;
        finish({
          success: false,
          responseBody: { message },
          errorMessage: message,
        });
        return throwError(() => error);
      }),
    );
  }
}
