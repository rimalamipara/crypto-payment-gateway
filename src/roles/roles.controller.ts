import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { DEFAULT_ROLES } from "../common/constants/roles.constants.ts";
import { Roles } from "../common/decorators/roles.decorator.ts";
import { AssignRoleDto } from "./dto/assign-role.dto.ts";
import { CreateRoleDto } from "./dto/create-role.dto.ts";
import { RoleResponseDto } from "./dto/role-response.dto.ts";
import { RolesService } from "./roles.service.ts";

@ApiTags("roles")
@ApiBearerAuth("access-token")
@Controller("roles")
export class RolesController {
  constructor(@Inject(RolesService) private readonly rolesService: RolesService) {}

  @Get()
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "List all roles (admin)" })
  @ApiOkResponse({ type: () => [RoleResponseDto] })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  findAll() {
    return this.rolesService.findAll();
  }

  @Post()
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "Create a dynamic role (admin)" })
  @ApiCreatedResponse({ type: () => RoleResponseDto })
  @ApiForbiddenResponse({ description: "Requires admin role" })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Post("assign")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "Assign a role to a user (admin)" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: "Requires admin role" })
  assign(@Body() dto: AssignRoleDto) {
    return this.rolesService.assign(dto);
  }

  @Post("revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(DEFAULT_ROLES.ADMIN)
  @ApiOperation({ summary: "Revoke a role from a user (admin)" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: "Requires admin role" })
  revoke(@Body() dto: AssignRoleDto) {
    return this.rolesService.revoke(dto);
  }
}
