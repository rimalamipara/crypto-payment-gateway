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
import { CreatePayoutDto } from "./dto/create-payout.dto.ts";
import { PayoutAssetDto } from "./dto/payout-asset.dto.ts";
import { PayoutResponseDto } from "./dto/payout-response.dto.ts";
import { PayoutsService } from "./payouts.service.ts";


@ApiTags("payouts")
@Controller("payouts")
export class PayoutsController {
  constructor(
    @Inject(PayoutsService) private readonly payoutsService: PayoutsService,
  ) {}

  @Post()
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "Withdraw USD from wallet via OxaPay payout",
  })
  @ApiCreatedResponse({ type: () => PayoutResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutDto,
  ) {
    return this.payoutsService.create(user, dto);
  }

  @Get()
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List my payouts (paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Paginated payouts" })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.payoutsService.listMine(
      user.id,
      parsePage(page),
      parseLimit(limit, 20),
    );
  }

  @Get("assets")
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "List OxaPay-supported payout currencies and networks",
  })
  @ApiOkResponse({ type: () => [PayoutAssetDto] })
  listAssets() {
    return this.payoutsService.listAssets();
  }

  @Get("admin")
  @ApiBearerAuth("access-token")
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "List all payouts (admin, paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Paginated payouts" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  listAll(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.payoutsService.listAll(parsePage(page), parseLimit(limit, 50));
  }

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "OxaPay payout webhook (HMAC with payout API key)" })
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

    const result = await this.payoutsService.handleWebhook(rawBody, hmac);
    res.status(HttpStatus.OK).type("text/plain").send(result);
  }

  @Get(":id")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get payout by id" })
  @ApiOkResponse({ type: () => PayoutResponseDto })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.payoutsService.getOne(user, id);
  }

  @Post(":id/sync")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Refresh payout status from OxaPay" })
  @ApiOkResponse({ type: () => PayoutResponseDto })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.payoutsService.syncFromOxaPay(user, id);
  }
}
