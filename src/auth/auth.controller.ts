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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import { Public } from "../common/decorators/public.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { AuthService } from "./auth.service.ts";
import {
  AuthTokensResponseDto,
  AuthUserDto,
} from "./dto/auth-response.dto.ts";
import { GoogleLoginDto } from "./dto/google-login.dto.ts";
import { LoginDto } from "./dto/login.dto.ts";
import { RegisterDto } from "./dto/register.dto.ts";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  @ApiOperation({ summary: "Register a new user (gets default `user` role)" })
  @ApiCreatedResponse({ type: () => AuthTokensResponseDto })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login and receive a JWT access token" })
  @ApiOkResponse({ type: () => AuthTokensResponseDto })
  @ApiUnauthorizedResponse({ description: "Invalid credentials" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post("google")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login/register with a Google ID token" })
  @ApiOkResponse({ type: () => AuthTokensResponseDto })
  google(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.idToken);
  }

  @Get("me")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Current authenticated user profile" })
  @ApiOkResponse({ type: () => AuthUserDto })
  @ApiUnauthorizedResponse({ description: "Missing or invalid token" })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }
}
