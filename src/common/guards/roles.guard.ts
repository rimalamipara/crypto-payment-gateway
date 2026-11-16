import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ROLES_KEY } from "../decorators/roles.decorator.ts";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface.ts";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() === "ws") {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of roles: ${requiredRoles.join(", ")}`,
      );
    }

    return true;
  }
}
