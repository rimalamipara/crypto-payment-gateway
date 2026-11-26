import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import {
  isGatewayName,
  PaymentGatewaysService,
} from "./payment-gateways.service.ts";

class SetGatewayEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags("admin-payment-gateways")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin/payment-gateways")
export class PaymentGatewaysAdminController {
  constructor(
    @Inject(PaymentGatewaysService)
    private readonly gateways: PaymentGatewaysService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List payment gateways with their enabled state" })
  list() {
    return this.gateways.list();
  }

  @Put(":name")
  @ApiOperation({
    summary:
      "Enable or disable a gateway. Disabled: no new invoices; webhooks for existing payments still process.",
  })
  set(@Param("name") name: string, @Body() dto: SetGatewayEnabledDto) {
    if (!isGatewayName(name)) throw new BadRequestException("Unknown gateway");
    return this.gateways.setEnabled(name, dto.enabled);
  }
}
