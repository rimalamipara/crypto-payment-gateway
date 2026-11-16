import * as bcrypt from "bcrypt";

import { connectDatabase, db } from "../src/prisma/db.ts";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const password = process.argv[3] ?? "";

if (!email || !password) {
  console.error("Usage: tsx --env-file=.env scripts/set-password.mts <email> <password>");
  process.exit(1);
}

async function main() {
  await connectDatabase();
  const user = await db.orm.public.User.where({ email })
    .select("id", "email", "isActive")
    .first();

  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.orm.public.User.where({ id: user.id }).update({
    passwordHash,
    isActive: true,
  });

  console.log(`Password updated for ${user.email} (id=${user.id})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
