import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/** Require at least one of the given role names (loaded dynamically from DB). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
