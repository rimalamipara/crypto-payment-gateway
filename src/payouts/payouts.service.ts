import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { IntegrationLogsService } from "../integration-logs/integration-logs.service.ts";
import { OxaPayClient } from "../oxapay/oxapay.client.ts";
import type { OxaPayWebhookPayload } from "../oxapay/oxapay.types.ts";
import { WalletService } from "../wallet/wallet.service.ts";
import { normalizeUsd } from "../wallet/wallet.math.ts";
import {
  normalizePayoutStatus,
  PAYOUT_STATUS,
} from "./constants/payout-status.ts";
import type { CreatePayoutDto } from "./dto/create-payout.dto.ts";
import type { PayoutAssetDto } from "./dto/payout-asset.dto.ts";
import type { PayoutResponseDto } from "./dto/payout-response.dto.ts";
import { PaymentGatewaysService } from "../payments/payment-gateways.service.ts";
import { PayoutsRepository } from "./payouts.repository.ts";

@Injectable()
export class PayoutsService {
  constructor(
    @Inject(PayoutsRepository)
    private readonly payoutsRepository: PayoutsRepository,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(OxaPayClient) private readonly oxaPay: OxaPayClient,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(IntegrationLogsService)
    private readonly integrationLogs: IntegrationLogsService,
    @Inject(PaymentGatewaysService)
    private readonly gateways: PaymentGatewaysService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreatePayoutDto,
  ): Promise<PayoutResponseDto> {
    if (
      !(await this.gateways.isEnabled("withdrawals")) ||
      !(await this.gateways.isEnabled("oxapay-withdrawals"))
    ) {
      throw new ServiceUnavailableException("Withdrawals are temporarily disabled");
    }
    const currency = dto.currency.trim().toUpperCase();
    const network = dto.network.trim();
    const amountUsd = normalizeUsd(dto.amountUsd);

    const payout = await this.payoutsRepository.create({
      userId: user.id,
      amountUsd,
      currency,
      network,
      address: dto.address.trim(),
      status: PAYOUT_STATUS.PENDING,
      memo: dto.memo ?? null,
      description: dto.description ?? null,
    });

    try {
      await this.walletService.debitForPayout({
        userId: user.id,
        amountUsd,
        payoutId: payout.id,
        description:
          dto.description ?? `Payout to ${currency} (${network})`,
      });
    } catch (error) {
      await this.payoutsRepository.updateById(payout.id, {
        status: PAYOUT_STATUS.FAILED,
      });
      throw error;
    }

    const callbackUrl = this.resolvePayoutCallbackUrl();
    try {
      const result = await this.oxaPay.createPayout({
        address: payout.address,
        currency,
        amount: Number(amountUsd),
        network,
        callback_url: callbackUrl,
        memo: dto.memo,
        description: dto.description ?? `payout_${payout.id}`,
      });

      return this.payoutsRepository.updateById(payout.id, {
        status: normalizePayoutStatus(result.status),
        trackId: result.track_id,
      });
    } catch (error) {
      await this.walletService.refundFailedPayout({
        userId: user.id,
        amountUsd,
        payoutId: payout.id,
      });
      await this.payoutsRepository.updateById(payout.id, {
        status: PAYOUT_STATUS.FAILED,
      });
      throw error;
    }
  }

  async listAssets(): Promise<PayoutAssetDto[]> {
    const currencies = await this.oxaPay.getSupportedCurrencies();
    const assets: PayoutAssetDto[] = [];

    for (const info of Object.values(currencies)) {
      if (!info?.status || !info.networks) continue;
      for (const net of Object.values(info.networks)) {
        if (!net?.network) continue;
        const networkKey = this.pickNetworkKey(net.network, net.keys ?? []);
        assets.push({
          currency: info.symbol,
          name: info.name,
          network: networkKey,
          networkName: net.name || net.network,
          label: `${info.symbol} / ${networkKey} (${net.name || net.network})`,
          withdrawFee: net.withdraw_fee,
          withdrawMin: net.withdraw_min,
        });
      }
    }

    return assets.sort((a, b) => a.label.localeCompare(b.label));
  }

  async listMine(userId: number, page = 1, limit = 50) {
    const { items, total } = await this.payoutsRepository.findByUserIdPage(
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
    const { items, total } = await this.payoutsRepository.findAllPage(
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
  ): Promise<PayoutResponseDto> {
    const payout = await this.payoutsRepository.findById(id);
    if (!payout) {
      throw new NotFoundException(`Payout ${id} not found`);
    }
    this.assertCanAccess(user, payout.userId);
    return payout;
  }

  async syncFromOxaPay(
    user: AuthenticatedUser,
    id: number,
  ): Promise<PayoutResponseDto> {
    const payout = await this.getOne(user, id);
    if (!payout.trackId) {
      throw new NotFoundException("Payout has no OxaPay track id");
    }

    const info = await this.oxaPay.getPayout(payout.trackId);
    const status = normalizePayoutStatus(info.status);
    const updated = await this.payoutsRepository.updateById(payout.id, {
      status,
      txHash: info.tx_hash ?? payout.txHash,
      fee: info.fee !== undefined ? String(info.fee) : payout.fee,
    });

    if (status === PAYOUT_STATUS.FAILED) {
      await this.walletService.refundFailedPayout({
        userId: payout.userId,
        amountUsd: payout.amountUsd,
        payoutId: payout.id,
      });
    }

    return updated;
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
      "payout",
    );

    let payload: OxaPayWebhookPayload | null = null;
    try {
      payload = JSON.parse(rawText) as OxaPayWebhookPayload;
    } catch {
      payload = null;
    }

    this.integrationLogs.recordWebhook({
      source: "oxapay",
      channel: "payout",
      method: "POST",
      path: "/payouts/webhook",
      requestBody: rawText,
      hmacHeader: hmacHeader ?? null,
      signatureValid,
      trackId: payload?.track_id ?? null,
      orderId: payload?.order_id ?? null,
      success: signatureValid,
      errorMessage: signatureValid
        ? null
        : "Invalid OxaPay payout HMAC signature",
      responseStatus: signatureValid ? 200 : 403,
      responseBody: signatureValid ? '"ok"' : null,
    });

    if (!signatureValid) {
      throw new ForbiddenException("Invalid OxaPay payout HMAC signature");
    }

    if (!payload?.track_id) {
      return "ok";
    }

    const payout = await this.payoutsRepository.findByTrackId(payload.track_id);
    if (!payout) {
      return "ok";
    }

    const status = normalizePayoutStatus(payload.status);
    await this.payoutsRepository.updateById(payout.id, {
      status,
      txHash: payload.tx_hash ?? payout.txHash,
      webhookPayload: JSON.stringify(payload),
    });

    if (status === PAYOUT_STATUS.FAILED) {
      await this.walletService.refundFailedPayout({
        userId: payout.userId,
        amountUsd: payout.amountUsd,
        payoutId: payout.id,
      });
    }

    return "ok";
  }

  private assertCanAccess(user: AuthenticatedUser, ownerId: number): void {
    if (user.id === ownerId || user.roles.includes(DEFAULT_ROLES.ADMIN)) {
      return;
    }
    throw new ForbiddenException("You cannot access this payout");
  }

  private pickNetworkKey(network: string, keys: string[]): string {
    const preferred = keys.find((key) =>
      /^(TRC20|ERC20|BEP20|POLYGON|TON|BASE|SOL|BTC|LTC|DOGE|BCH)$/i.test(key),
    );
    return preferred ?? keys[0] ?? network;
  }

  private resolvePayoutCallbackUrl(): string | undefined {
    const explicit = this.config.get<string>("oxapay.payoutCallbackUrl");
    if (explicit) {
      return explicit;
    }
    const base = this.config.get<string>("app.baseUrl");
    if (!base) {
      return undefined;
    }
    return `${base.replace(/\/$/, "")}/payouts/webhook`;
  }
}
