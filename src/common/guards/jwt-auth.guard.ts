import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";

import { IS_PUBLIC_KEY } from "../decorators/public.decorator.ts";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface.ts";

interface JwtPayload {
  sub: number;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Socket.IO auth is handled in PokerGateway handshake.
    if (context.getType() === "ws") {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();

    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing or invalid authorization token");
    }

    try {
      const secret = this.configService.getOrThrow<string>("jwt.secret");
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
      });

      request.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? [],
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private extractBearerToken(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }
    const [type, token] = authorization.split(" ");
    return type === "Bearer" && token ? token : null;
  }
}
