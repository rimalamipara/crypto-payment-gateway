import { Body, Controller, Get, HttpCode, Inject, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { CoolingOffDto, SelfExcludeDto, SetLimitsDto } from "./dto/rg.dto.ts";
import { ResponsibleGamblingService } from "./rg.service.ts";

@ApiTags("responsible-gambling")
@ApiBearerAuth("access-token")
@Controller("responsible-gambling")
export class ResponsibleGamblingController {
  constructor(@Inject(ResponsibleGamblingService) private readonly rg: ResponsibleGamblingService) {}

  @Get()
  @ApiOperation({ summary: "My limits, cooling-off and self-exclusion status" })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.rg.get(user.id);
  }

  @Put("limits")
  @ApiOperation({ summary: "Set/clear daily deposit and loss limits (null clears)" })
  limits(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetLimitsDto) {
    return this.rg.setLimits(user.id, dto);
  }

  @Post("cooling-off")
  @HttpCode(200)
  @ApiOperation({ summary: "Take a break for 1, 7 or 30 days (cannot be shortened)" })
  coolOff(@CurrentUser() user: AuthenticatedUser, @Body() dto: CoolingOffDto) {
    return this.rg.coolOff(user.id, dto.days);
  }

  @Post("self-exclude")
  @HttpCode(200)
  @ApiOperation({ summary: "Self-exclude for 30/90/180/365 days or permanently (0). Irreversible." })
  selfExclude(@CurrentUser() user: AuthenticatedUser, @Body() dto: SelfExcludeDto) {
    return this.rg.selfExclude(user.id, dto.days);
  }
}
