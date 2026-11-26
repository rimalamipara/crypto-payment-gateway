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
import { DisableTwoFactorDto, TwoFactorCodeDto, TwoFactorLoginDto } from "./dto/two-factor.dto.ts";
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

  @Public()
  @Post("2fa/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Complete login with the TOTP code after a twoFactorRequired response" })
  @ApiOkResponse({ type: () => AuthTokensResponseDto })
  twoFactorLogin(@Body() dto: TwoFactorLoginDto) {
    return this.authService.loginWithTwoFactor(dto.twoFactorToken, dto.code);
  }

  @Post("2fa/setup")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Generate a TOTP secret + otpauth URL (not active until /2fa/enable)" })
  twoFactorSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupTwoFactor(user.id);
  }

  @Post("2fa/enable")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Activate 2FA by confirming a code" })
  twoFactorEnable(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorCodeDto) {
    return this.authService.enableTwoFactor(user.id, dto.code);
  }

  @Post("2fa/disable")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Disable 2FA (needs password + current code)" })
  twoFactorDisable(@CurrentUser() user: AuthenticatedUser, @Body() dto: DisableTwoFactorDto) {
    return this.authService.disableTwoFactor(user.id, dto.password, dto.code);
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
