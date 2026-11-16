import { connectDatabase, db } from "../src/prisma/db.ts";

await connectDatabase();
const seats = await db.orm.public.PokerSeat.all();
for (const s of seats) {
  await db.orm.public.PokerSeat.where({ id: s.id }).delete();
  console.log("deleted seat", s.id, "user", s.userId, s.status);
}
const hands = await db.orm.public.PokerHand.where({ status: "active" }).all();
for (const h of hands) {
  await db.orm.public.PokerHand.where({ id: h.id }).update({
    status: "cancelled",
    endedAt: new Date().toISOString(),
  });
  console.log("cancelled hand", h.id);
}
await db.close?.();
console.log("cleared");
process.exit(0);
