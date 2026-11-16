import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { IntegrationLogsService } from "../integration-logs/integration-logs.service.ts";
import { OxaPayClient } from "../oxapay/oxapay.client.ts";
import type { OxaPayWebhookPayload } from "../oxapay/oxapay.types.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import {
  normalizeOxaPayStatus,
  PAYMENT_STATUS,
} from "./constants/payment-status.ts";
import type { CreatePaymentDto } from "./dto/create-payment.dto.ts";
import type { PaymentResponseDto } from "./dto/payment-response.dto.ts";
import { PaymentsRepository } from "./payments.repository.ts";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PaymentsRepository)
    private readonly paymentsRepository: PaymentsRepository,
    @Inject(OxaPayClient) private readonly oxaPay: OxaPayClient,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(IntegrationLogsService)
    private readonly integrationLogs: IntegrationLogsService,
  ) {}

  async createInvoice(
    user: AuthenticatedUser,
    dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    const currency = "USD";
    const orderId = this.buildOrderId(user.id);
    const callbackUrl = this.resolveCallbackUrl();
    const email = dto.email ?? user.email;
    const amount = normalizeUsd(dto.amount);

    const invoice = await this.oxaPay.createInvoice({
      amount: Number(amount),
      currency,
      lifetime: dto.lifetime ?? 60,
      order_id: orderId,
      email,
      description: dto.description ?? "USD wallet top-up",
      return_url: dto.returnUrl,
      callback_url: callbackUrl,
      to_currency: "USDT",
      // OxaPay Hosted Payment Page (invoice) options
      fee_paid_by_payer: 1,
      mixed_payment: true,
      thanks_message: "Top-up received. You can return to your wallet.",
    });

    return this.paymentsRepository.create({
      orderId,
      userId: user.id,
      amount,
      currency,
      purpose: "topup",
      description: dto.description ?? "USD wallet top-up",
      email,
      returnUrl: dto.returnUrl ?? null,
      status: PAYMENT_STATUS.NEW,
      trackId: invoice.track_id,
      paymentUrl: invoice.payment_url,
      expiresAt: this.fromUnix(invoice.expired_at),
    });
  }

  async listMine(userId: number, page = 1, limit = 50) {
    const { items, total } = await this.paymentsRepository.findByUserIdPage(
      userId,
      page,
      limit,
    );
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listAll(page = 1, limit = 50) {
    const { items, total } = await this.paymentsRepository.findAllPage(
      page,
      limit,
    );
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getOne(
    user: AuthenticatedUser,
    id: number,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentsRepository.findById(id);
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    this.assertCanAccess(user, payment.userId);
    return payment;
  }

  async syncFromOxaPay(
    user: AuthenticatedUser,
    id: number,
  ): Promise<PaymentResponseDto> {
    const payment = await this.getOne(user, id);
    if (!payment.trackId) {
      throw new NotFoundException("Payment has no OxaPay track id");
    }

    const info = await this.oxaPay.getPayment(payment.trackId);
    const status = normalizeOxaPayStatus(info.status);
    const latestTx = info.txs?.[0];

    const updated = await this.paymentsRepository.updateById(payment.id, {
      status,
      paidCurrency: latestTx?.currency ?? payment.paidCurrency,
      paidAmount:
        latestTx?.amount !== undefined
          ? String(latestTx.amount)
          : payment.paidAmount,
      txHash: latestTx?.tx_hash ?? payment.txHash,
      expiresAt: info.expired_at
        ? this.fromUnix(info.expired_at)
        : payment.expiresAt,
      paidAt:
        status === PAYMENT_STATUS.PAID || status === PAYMENT_STATUS.MANUAL_ACCEPT
          ? (payment.paidAt ?? new Date().toISOString())
          : payment.paidAt,
    });

    await this.maybeCreditWallet(updated);
    return this.paymentsRepository.findById(updated.id) as Promise<PaymentResponseDto>;
  }

  async handleWebhook(
    rawBody: Buffer | string,
    hmacHeader: string | undefined,
  ): Promise<"ok"> {
    const rawText =
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const signatureValid = this.oxaPay.verifyWebhookSignature(
      rawBody,
      hmacHeader,
      "merchant",
    );

    let payload: OxaPayWebhookPayload | null = null;
    try {
      payload = JSON.parse(rawText) as OxaPayWebhookPayload;
    } catch {
      payload = null;
    }

    this.integrationLogs.recordWebhook({
      source: "oxapay",
      channel: "merchant",
      method: "POST",
      path: "/payments/webhook",
      requestBody: rawText,
      hmacHeader: hmacHeader ?? null,
      signatureValid,
      trackId: payload?.track_id ?? null,
      orderId: payload?.order_id ?? null,
      success: signatureValid,
      errorMessage: signatureValid ? null : "Invalid OxaPay HMAC signature",
      responseStatus: signatureValid ? 200 : 403,
      responseBody: signatureValid ? '"ok"' : null,
    });

    if (!signatureValid) {
      throw new ForbiddenException("Invalid OxaPay HMAC signature");
    }

    if (!payload?.track_id && !payload?.order_id) {
      throw new ForbiddenException("Invalid webhook payload");
    }

    const payment =
      (payload.order_id
        ? await this.paymentsRepository.findByOrderId(payload.order_id)
        : null) ??
      (payload.track_id
        ? await this.paymentsRepository.findByTrackId(payload.track_id)
        : null);

    if (!payment) {
      return "ok";
    }

    const status = normalizeOxaPayStatus(payload.status);
    const latestTx = payload.txs?.[0];

    const updated = await this.paymentsRepository.updateById(payment.id, {
      status,
      trackId: payload.track_id || payment.trackId,
      paidCurrency: latestTx?.currency ?? payment.paidCurrency,
      paidAmount:
        latestTx?.received_amount !== undefined
          ? String(latestTx.received_amount)
          : latestTx?.amount !== undefined
            ? String(latestTx.amount)
            : payment.paidAmount,
      txHash: latestTx?.tx_hash ?? payment.txHash,
      webhookPayload: JSON.stringify(payload),
      paidAt:
        status === PAYMENT_STATUS.PAID || status === PAYMENT_STATUS.MANUAL_ACCEPT
          ? (payment.paidAt ?? new Date().toISOString())
          : payment.paidAt,
    });

    await this.maybeCreditWallet(updated);
    return "ok";
  }

  private async maybeCreditWallet(payment: PaymentResponseDto): Promise<void> {
    if (
      payment.walletCredited ||
      payment.purpose !== "topup" ||
      (payment.status !== PAYMENT_STATUS.PAID &&
        payment.status !== PAYMENT_STATUS.MANUAL_ACCEPT)
    ) {
      return;
    }

    try {
      await this.walletService.creditFromTopupPayment(payment.id);
    } catch (error) {
      this.logger.error(
        `Failed to credit wallet for payment ${payment.id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  private assertCanAccess(user: AuthenticatedUser, ownerId: number): void {
    if (user.id === ownerId || user.roles.includes(DEFAULT_ROLES.ADMIN)) {
      return;
    }
    throw new ForbiddenException("You cannot access this payment");
  }

  private buildOrderId(userId: number): string {
    const suffix = randomBytes(3).toString("hex");
    return `ord_${userId}_${Date.now()}_${suffix}`;
  }

  private resolveCallbackUrl(): string | undefined {
    const explicit = this.config.get<string>("oxapay.callbackUrl");
    if (explicit) {
      return explicit;
    }
    const base = this.config.get<string>("app.baseUrl");
    if (!base) {
      return undefined;
    }
    return `${base.replace(/\/$/, "")}/payments/webhook`;
  }

  private fromUnix(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString();
  }
}
