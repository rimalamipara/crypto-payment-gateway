import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../prisma/prisma.service.ts";
import type { SubmitKycDto } from "./dto/kyc.dto.ts";
import { isAdult } from "./kyc.rules.ts";

@Injectable()
export class KycService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private get kyc() {
    return this.prisma.client.orm.public.Kyc;
  }

  async getMine(userId: number) {
    const row = await this.kyc.where({ userId }).first();
    return row ?? { status: "none" };
  }

  async submit(userId: number, dto: SubmitKycDto) {
    if (!isAdult(dto.dateOfBirth)) {
      throw new BadRequestException("You must be at least 18 years old");
    }
    const existing = await this.kyc.where({ userId }).first();
    if (existing && existing.status !== "rejected") {
      throw new ConflictException(`KYC already ${existing.status}`);
    }
    const data = {
      ...dto,
      docBackUrl: dto.docBackUrl ?? null,
      status: "pending",
      rejectReason: null,
      reviewedBy: null,
      reviewedAt: null,
    };
    if (existing) await this.kyc.where({ id: existing.id }).update(data);
    else await this.kyc.create({ userId, ...data });
    return this.getMine(userId);
  }

  async listByStatus(status: string, limit = 100) {
    return this.kyc.where({ status }).orderBy((k) => k.id.asc()).limit(limit).all();
  }

  async review(id: number, reviewerId: number, approve: boolean, reason?: string) {
    const row = await this.kyc.where({ id }).first();
    if (!row) throw new NotFoundException("KYC submission not found");
    if (row.status !== "pending") throw new ConflictException(`KYC already ${row.status}`);
    await this.kyc.where({ id }).update({
      status: approve ? "approved" : "rejected",
      rejectReason: approve ? null : (reason ?? null),
      reviewedBy: reviewerId,
      reviewedAt: new Date().toISOString(),
    });
    return this.kyc.where({ id }).first();
  }

  /** Withdrawals require approved KYC only when KYC_REQUIRED_FOR_WITHDRAWAL=true (default off). */
  async assertWithdrawalAllowed(userId: number) {
    if (this.config.get("KYC_REQUIRED_FOR_WITHDRAWAL") !== "true") return;
    const row = await this.kyc.where({ userId }).select("status").first();
    if (row?.status !== "approved") {
      throw new ForbiddenException("Identity verification (KYC) is required to withdraw");
    }
  }
}
