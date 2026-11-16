/**
 * Credits poker smoke test users' wallets to $200 each.
 * Run with: node --env-file=.env --experimental-strip-types scripts/poker-fund.mjs
 * Or: npx tsx --env-file=.env scripts/poker-fund.mjs
 */
import { connectDatabase, db } from "../src/prisma/db.ts";

const emails = ["poker.p1@example.com", "poker.p2@example.com"];

await connectDatabase();

for (const email of emails) {
  const user = await db.orm.public.User.where({ email }).first();
  if (!user) {
    console.log("User missing (register via smoke first):", email);
    continue;
  }
  let wallet = await db.orm.public.Wallet.where({ userId: user.id }).first();
  if (!wallet) {
    wallet = await db.orm.public.Wallet.create({
      userId: user.id,
      balanceUsd: "200.00000000",
      currency: "USD",
    });
  } else {
    await db.orm.public.Wallet.where({ id: wallet.id }).update({
      balanceUsd: "200.00000000",
    });
  }
  await db.orm.public.WalletTransaction.create({
    walletId: wallet.id,
    type: "adjust",
    amountUsd: "200.00000000",
    balanceAfter: "200.00000000",
    referenceType: "smoke",
    description: "Poker smoke fund",
  });
  console.log("Funded", email, "userId", user.id);
}

await db.close?.();
console.log("Done");
process.exit(0);
