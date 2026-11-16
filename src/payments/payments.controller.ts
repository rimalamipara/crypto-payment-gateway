import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import { Public } from "../common/decorators/public.decorator.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { parseLimit, parsePage } from "../common/pagination.ts";
import { CreatePaymentDto } from "./dto/create-payment.dto.ts";
import { PaymentResponseDto } from "./dto/payment-response.dto.ts";
import { PaymentsService } from "./payments.service.ts";

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Create USD wallet top-up invoice (OxaPay)" })
  @ApiCreatedResponse({ type: () => PaymentResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createInvoice(user, dto);
  }

  @Get()
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List my payments (paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Paginated payments" })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.paymentsService.listMine(
      user.id,
      parsePage(page),
      parseLimit(limit, 20),
    );
  }

  @Get("admin")
  @ApiBearerAuth("access-token")
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "List all payments (admin, paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Paginated payments" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  listAll(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.paymentsService.listAll(parsePage(page), parseLimit(limit, 50));
  }

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "OxaPay payment webhook (HMAC verified, returns plain OK)",
  })
  @ApiOkResponse({ description: "Plain text OK" })
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("hmac") hmac: string | undefined,
    @Res() res: Response,
  ) {
    const rawBody =
      req.rawBody ??
      (typeof req.body === "string"
        ? req.body
        : Buffer.from(JSON.stringify(req.body ?? {})));

    const result = await this.paymentsService.handleWebhook(rawBody, hmac);
    res.status(HttpStatus.OK).type("text/plain").send(result);
  }

  @Get(":id")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get payment by id" })
  @ApiOkResponse({ type: () => PaymentResponseDto })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.paymentsService.getOne(user, id);
  }

  @Post(":id/sync")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Refresh payment status from OxaPay" })
  @ApiOkResponse({ type: () => PaymentResponseDto })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.paymentsService.syncFromOxaPay(user, id);
  }
}
