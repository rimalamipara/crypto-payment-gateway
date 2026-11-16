import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { VaultAmountDto } from "./dto/vault.dto.ts";
import {
  WalletResponseDto,
  WalletStatsDto,
} from "./dto/wallet-response.dto.ts";
import { WalletService } from "./wallet.service.ts";

@ApiTags("wallet")
@ApiBearerAuth("access-token")
@Controller("wallet")
export class WalletController {
  constructor(@Inject(WalletService) private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: "Get my USD wallet + vault balance" })
  @ApiOkResponse({ type: () => WalletResponseDto })
  getBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getBalance(user.id);
  }

  @Get("stats")
  @ApiOperation({ summary: "Total wagered and profit/loss (Stake-style)" })
  @ApiOkResponse({ type: () => WalletStatsDto })
  getStats(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getStats(user.id);
  }

  @Get("transactions")
  @ApiOperation({ summary: "List my wallet ledger entries (paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: "Paginated wallet transactions" })
  listTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedPage = page !== undefined ? Number(page) : 1;
    const safePage =
      Number.isFinite(parsedPage) && parsedPage > 0
        ? Math.floor(parsedPage)
        : 1;
    const parsed = limit !== undefined ? Number(limit) : 20;
    const safe =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    return this.walletService.listTransactions(user.id, safePage, safe);
  }

  @Post("vault/deposit")
  @ApiOperation({ summary: "Move USD from wallet into vault (locks from play)" })
  @ApiOkResponse({ type: () => WalletResponseDto })
  vaultDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VaultAmountDto,
  ) {
    return this.walletService.depositToVault(user.id, dto.amountUsd);
  }

  @Post("vault/withdraw")
  @ApiOperation({ summary: "Move USD from vault back to spendable wallet" })
  @ApiOkResponse({ type: () => WalletResponseDto })
  vaultWithdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VaultAmountDto,
  ) {
    return this.walletService.withdrawFromVault(user.id, dto.amountUsd);
  }
}
