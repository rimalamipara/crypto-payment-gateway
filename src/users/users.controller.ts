import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { parseLimit, parsePage } from "../common/pagination.ts";
import { UserResponseDto } from "./dto/user-response.dto.ts";
import { UsersService } from "./users.service.ts";

@ApiTags("users")
@ApiBearerAuth("access-token")
@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "List users (admin, paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 50 })
  @ApiOkResponse({ description: "Paginated users" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  findAll(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.usersService.findAll(parsePage(page), parseLimit(limit, 50));
  }

  @Delete(":id")
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({
    summary: "Soft-delete a user or admin (sets isActive=false)",
  })
  @ApiOkResponse({ type: () => UserResponseDto })
  @ApiNotFoundResponse({ description: "User not found" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  softDelete(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.softDelete(id, actor);
  }

  @Post(":id/restore")
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "Restore a soft-deleted user or admin" })
  @ApiOkResponse({ type: () => UserResponseDto })
  @ApiNotFoundResponse({ description: "User not found" })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  restore(@Param("id", ParseIntPipe) id: number): Promise<UserResponseDto> {
    return this.usersService.restore(id);
  }
}
