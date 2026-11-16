/** Default role names seeded at startup. More roles can be created at runtime. */
export const DEFAULT_ROLES = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type DefaultRoleName =
  (typeof DEFAULT_ROLES)[keyof typeof DEFAULT_ROLES];
