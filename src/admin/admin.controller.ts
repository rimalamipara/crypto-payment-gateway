import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import { UserResponseDto } from "../users/dto/user-response.dto.ts";
import { UsersService } from "../users/users.service.ts";
import { AdminStatsService } from "./admin-stats.service.ts";
import { CreateAdminDto } from "../users/dto/create-admin.dto.ts";
import { AdminStatsDto } from "./dto/admin-stats.dto.ts";

@ApiTags("admin")
@ApiBearerAuth("access-token")
@Roles(DEFAULT_ROLES.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(
    @Inject(AdminStatsService)
    private readonly adminStatsService: AdminStatsService,
    @Inject(UsersService) private readonly usersService: UsersService,
  ) {}

  @Get("stats")
  @ApiOperation({
    summary:
      "Platform stats: payment/payout counts & amounts, total wallet balance (admin)",
  })
  @ApiOkResponse({ type: () => AdminStatsDto })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  getStats() {
    return this.adminStatsService.getOverview();
  }

  @Post("users")
  @ApiOperation({ summary: "Create a new admin user" })
  @ApiCreatedResponse({ type: () => UserResponseDto })
  @ApiConflictResponse({ description: "Email already registered" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  createAdmin(@Body() dto: CreateAdminDto): Promise<UserResponseDto> {
    return this.usersService.createAdmin(dto);
  }
}
