import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/profile.dto.ts";
import { ProfileService } from "./profile.service.ts";

@ApiTags("profile")
@ApiBearerAuth("access-token")
@Controller("profile")
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: "My profile" })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profile.get(user.id);
  }

  @Patch()
  @ApiOperation({ summary: "Update my profile (name, username, phone, country, avatarUrl)" })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.profile.update(user.id, dto);
  }

  @Post("change-password")
  @HttpCode(200)
  @ApiOperation({ summary: "Change my password" })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.profile.changePassword(user.id, dto);
  }
}
