import { connectDatabase, db } from "./db.ts";

const defaultRoles = [
  { name: "user", description: "Default application user" },
  { name: "admin", description: "Administrator with elevated access" },
];

let pendingSeed: Promise<void> | undefined;

async function runSeed(): Promise<void> {
  await connectDatabase();

  for (const role of defaultRoles) {
    await db.orm.public.Role.upsert({
      create: {
        name: role.name,
        description: role.description,
        isActive: true,
      },
      update: {
        description: role.description,
        isActive: true,
      },
      conflictOn: { name: role.name },
    });
  }
}

/** Seeds dynamic default roles (`user`, `admin`). Safe to call repeatedly. */
export function seed(): Promise<void> {
  pendingSeed ??= runSeed().catch((error: unknown) => {
    pendingSeed = undefined;
    throw error;
  });
  return pendingSeed;
}
