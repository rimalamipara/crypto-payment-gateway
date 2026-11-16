import { connectDatabase, db } from "../src/prisma/db.ts";

const emails = ["color.p1@example.com", "color.p2@example.com"];

await connectDatabase();

for (const email of emails) {
  const user = await db.orm.public.User.where({ email }).first();
  if (!user) {
    console.log("missing user", email);
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
    description: "Color smoke fund",
  });
  console.log("funded", email, user.id);
}

await db.close?.();
process.exit(0);
