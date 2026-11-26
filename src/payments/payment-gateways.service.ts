import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.ts";

/** "deposits" and "withdrawals" are platform-wide switches; the rest are gateways. */
export const PAYMENT_GATEWAYS = ["deposits", "withdrawals", "oxapay"] as const;
export type PaymentGatewayName = (typeof PAYMENT_GATEWAYS)[number];

export function isGatewayName(v: string): v is PaymentGatewayName {
  return (PAYMENT_GATEWAYS as readonly string[]).includes(v);
}

/** Admin on/off switches for payment gateways and platform deposits/withdrawals. A gateway with no stored row is enabled. */
@Injectable()
export class PaymentGatewaysService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get orm() {
    return this.prisma.client.orm.public;
  }

  async isEnabled(name: PaymentGatewayName): Promise<boolean> {
    const row = await this.orm.PaymentGateway.where({ name }).first();
    return row?.enabled ?? true;
  }

  async list() {
    const rows = await this.orm.PaymentGateway.all();
    return PAYMENT_GATEWAYS.map((name) => ({
      name,
      enabled: rows.find((r) => r.name === name)?.enabled ?? true,
    }));
  }

  async setEnabled(name: PaymentGatewayName, enabled: boolean) {
    const row = await this.orm.PaymentGateway.where({ name }).first();
    if (row) await this.orm.PaymentGateway.where({ id: row.id }).update({ enabled });
    else await this.orm.PaymentGateway.create({ name, enabled });
    return { name, enabled };
  }
}
