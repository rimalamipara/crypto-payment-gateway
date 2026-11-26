import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { RejectKycDto, SubmitKycDto } from "./dto/kyc.dto.ts";
import { KycService } from "./kyc.service.ts";

@ApiTags("kyc")
@ApiBearerAuth("access-token")
@Controller()
export class KycController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get("kyc")
  @ApiOperation({ summary: "My KYC status (status: none if never submitted)" })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.getMine(user.id);
  }

  @Post("kyc")
  @ApiOperation({ summary: "Submit identity documents (18+ only)" })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitKycDto) {
    return this.kyc.submit(user.id, dto);
  }

  @Get("admin/kyc")
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "List KYC submissions by status (default pending)" })
  list(@Query("status") status = "pending") {
    return this.kyc.listByStatus(status);
  }

  @Post("admin/kyc/:id/approve")
  @Roles(DEFAULT_ROLES.ADMIN)
  approve(@Param("id", ParseIntPipe) id: number, @CurrentUser() admin: AuthenticatedUser) {
    return this.kyc.review(id, admin.id, true);
  }

  @Post("admin/kyc/:id/reject")
  @Roles(DEFAULT_ROLES.ADMIN)
  reject(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: RejectKycDto,
  ) {
    return this.kyc.review(id, admin.id, false, dto.reason);
  }
}
