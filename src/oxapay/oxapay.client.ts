import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

import { IntegrationLogsService } from "../integration-logs/integration-logs.service.ts";
import type {
  OxaPayApiResponse,
  OxaPayCurrenciesMap,
  OxaPayInvoiceData,
  OxaPayInvoiceRequest,
  OxaPayPaymentInfo,
  OxaPayPayoutData,
  OxaPayPayoutInfo,
  OxaPayPayoutRequest,
} from "./oxapay.types.ts";

@Injectable()
export class OxaPayClient {
  private readonly logger = new Logger(OxaPayClient.name);
  private readonly baseUrl: string;
  private readonly merchantApiKey: string;
  private readonly payoutApiKey: string;
  private readonly sandbox: boolean;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(IntegrationLogsService)
    private readonly integrationLogs: IntegrationLogsService,
  ) {
    this.baseUrl = this.config
      .get<string>("oxapay.baseUrl", "https://api.oxapay.com/v1")
      .replace(/\/$/, "");
    this.merchantApiKey = (
      process.env.OXAPAY_MERCHANT_API_KEY ??
      this.config.get<string>("oxapay.merchantApiKey", "") ??
      ""
    ).trim();
    this.payoutApiKey = (
      process.env.OXAPAY_PAYOUT_API_KEY ??
      this.config.get<string>("oxapay.payoutApiKey", "") ??
      ""
    ).trim();
    this.sandbox = this.config.get<boolean>("oxapay.sandbox", true);
  }

  assertMerchantConfigured(): void {
    if (!this.merchantApiKey) {
      throw new BadGatewayException(
        "OxaPay merchant is not configured. Set OXAPAY_MERCHANT_API_KEY in .env",
      );
    }
  }

  assertPayoutConfigured(): void {
    if (!this.payoutApiKey) {
      throw new BadGatewayException(
        "OxaPay payout is not configured. Set OXAPAY_PAYOUT_API_KEY in .env",
      );
    }
  }

  async createInvoice(
    payload: Omit<OxaPayInvoiceRequest, "sandbox">,
  ): Promise<OxaPayInvoiceData> {
    this.assertMerchantConfigured();
    const body: OxaPayInvoiceRequest = {
      ...payload,
      sandbox: this.sandbox,
    };
    const response = await this.request<OxaPayInvoiceData>(
      "POST",
      "/payment/invoice",
      body,
      "merchant",
    );
    return response.data;
  }

  async getPayment(trackId: string): Promise<OxaPayPaymentInfo> {
    this.assertMerchantConfigured();
    const response = await this.request<OxaPayPaymentInfo>(
      "GET",
      `/payment/${encodeURIComponent(trackId)}`,
      undefined,
      "merchant",
    );
    return response.data;
  }

  isSandbox(): boolean {
    return this.sandbox;
  }

  async createPayout(payload: OxaPayPayoutRequest): Promise<OxaPayPayoutData> {
    // OxaPay only documents sandbox for invoices. When OXAPAY_SANDBOX=true we
    // simulate payouts locally (no OxaPay balance needed).
    if (this.sandbox) {
      const trackId = `sandbox_payout_${Date.now()}`;
      const simulated: OxaPayPayoutData = {
        track_id: trackId,
        status: "confirmed",
      };
      this.logger.log(
        `Sandbox payout simulated track_id=${trackId} ${payload.amount} ${payload.currency} -> ${payload.address}`,
      );
      this.integrationLogs.recordApi({
        direction: "outbound",
        source: "oxapay",
        method: "POST",
        path: "/payout",
        url: `${this.baseUrl}/payout`,
        requestBody: IntegrationLogsService.safeJson({
          ...payload,
          sandbox: true,
          simulated: true,
        }),
        responseStatus: 200,
        responseBody: IntegrationLogsService.safeJson({
          status: 200,
          data: simulated,
          message: "Sandbox simulated payout",
        }),
        trackId,
        success: true,
      });
      return simulated;
    }

    this.assertPayoutConfigured();
    const response = await this.request<OxaPayPayoutData>(
      "POST",
      "/payout",
      payload,
      "payout",
    );
    return response.data;
  }

  async getPayout(trackId: string): Promise<OxaPayPayoutInfo> {
    if (this.sandbox || trackId.startsWith("sandbox_payout_")) {
      const simulated: OxaPayPayoutInfo = {
        track_id: trackId,
        status: "confirmed",
        tx_hash: `sandbox_tx_${trackId.replace("sandbox_payout_", "")}`,
      };
      this.integrationLogs.recordApi({
        direction: "outbound",
        source: "oxapay",
        method: "GET",
        path: `/payout/${trackId}`,
        url: `${this.baseUrl}/payout/${encodeURIComponent(trackId)}`,
        responseStatus: 200,
        responseBody: IntegrationLogsService.safeJson({
          status: 200,
          data: simulated,
          message: "Sandbox simulated payout lookup",
        }),
        trackId,
        success: true,
      });
      return simulated;
    }

    this.assertPayoutConfigured();
    const response = await this.request<OxaPayPayoutInfo>(
      "GET",
      `/payout/${encodeURIComponent(trackId)}`,
      undefined,
      "payout",
    );
    return response.data;
  }

  async getSupportedCurrencies(): Promise<OxaPayCurrenciesMap> {
    const path = "/common/currencies";
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json()) as OxaPayApiResponse<OxaPayCurrenciesMap>;
      const ok = json.status === 200 && !!json.data;
      this.integrationLogs.recordApi({
        direction: "outbound",
        source: "oxapay",
        method: "GET",
        path,
        url,
        responseStatus: json.status ?? res.status,
        responseBody: IntegrationLogsService.safeJson({
          status: json.status,
          message: json.message,
          error: json.error,
          dataKeys: json.data ? Object.keys(json.data) : [],
        }),
        success: ok,
        errorMessage: ok
          ? null
          : json.error?.message || json.message || "Failed to load currencies",
      });
      if (!ok) {
        throw new BadGatewayException(
          json.error?.message ||
            json.message ||
            "Failed to load OxaPay currencies",
        );
      }
      return json.data;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      this.integrationLogs.recordApi({
        direction: "outbound",
        source: "oxapay",
        method: "GET",
        path,
        url,
        success: false,
        errorMessage:
          error instanceof Error ? error.message : "Failed to reach OxaPay",
      });
      this.logger.error("OxaPay currencies request failed", error);
      throw new BadGatewayException("Failed to reach OxaPay currencies API");
    }
  }

  verifyWebhookSignature(
    rawBody: string | Buffer,
    hmacHeader: string | undefined,
    kind: "merchant" | "payout" = "merchant",
  ): boolean {
    const secret =
      kind === "payout" ? this.payoutApiKey : this.merchantApiKey;
    if (!secret || !hmacHeader) {
      return false;
    }

    const calculated = createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    try {
      const left = Buffer.from(calculated, "utf8");
      const right = Buffer.from(hmacHeader, "utf8");
      if (left.length !== right.length) {
        return false;
      }
      return timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown | undefined,
    auth: "merchant" | "payout",
  ): Promise<OxaPayApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (auth === "merchant") {
      headers.merchant_api_key = this.merchantApiKey;
    } else {
      headers.payout_api_key = this.payoutApiKey;
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let json: OxaPayApiResponse<T> | undefined;
    let httpStatus: number | undefined;
    try {
      const res = await fetch(url, init);
      httpStatus = res.status;
      json = (await res.json()) as OxaPayApiResponse<T>;
    } catch (error) {
      this.integrationLogs.recordApi({
        direction: "outbound",
        source: "oxapay",
        method,
        path,
        url,
        requestHeaders: IntegrationLogsService.redactHeaders(headers),
        requestBody: IntegrationLogsService.safeJson(body),
        success: false,
        errorMessage:
          error instanceof Error ? error.message : "Failed to reach OxaPay API",
        trackId: IntegrationLogsService.extractTrackId(body),
        orderId: IntegrationLogsService.extractOrderId(body),
      });
      this.logger.error(`OxaPay request failed: ${method} ${path}`, error);
      throw new BadGatewayException("Failed to reach OxaPay API");
    }

    const ok = json.status === 200 && !!json.data;
    this.integrationLogs.recordApi({
      direction: "outbound",
      source: "oxapay",
      method,
      path,
      url,
      requestHeaders: IntegrationLogsService.redactHeaders(headers),
      requestBody: IntegrationLogsService.safeJson(body),
      responseStatus: json.status ?? httpStatus,
      responseBody: IntegrationLogsService.safeJson(json),
      success: ok,
      errorMessage: ok
        ? null
        : json.error?.message || json.message || "OxaPay API request failed",
      trackId:
        IntegrationLogsService.extractTrackId(json) ??
        IntegrationLogsService.extractTrackId(body),
      orderId:
        IntegrationLogsService.extractOrderId(json) ??
        IntegrationLogsService.extractOrderId(body),
    });

    if (!ok) {
      const message =
        json.error?.message || json.message || "OxaPay API request failed";
      const keyHint =
        auth === "merchant"
          ? this.maskKey(this.merchantApiKey)
          : this.maskKey(this.payoutApiKey);
      this.logger.warn(
        `OxaPay error on ${path}: ${message} (using ${auth} key ${keyHint})`,
      );
      throw new BadGatewayException(message);
    }

    return json;
  }

  private maskKey(key: string): string {
    if (!key) return "(empty)";
    if (key.length < 10) return `(len=${key.length})`;
    return `${key.slice(0, 6)}?${key.slice(-4)} (len=${key.length})`;
  }
}
