import "dotenv/config";
import pg from "pg";

const c = new pg.Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(`
  SELECT "userId",
         COUNT(*)::int AS seats,
         array_agg("tableId" ORDER BY "tableId") AS table_ids,
         array_agg(status) AS statuses
  FROM "PokerSeat"
  WHERE status <> 'left'
  GROUP BY "userId"
  HAVING COUNT(*) > 1
  ORDER BY "userId"
`);
console.log(JSON.stringify({ count: r.rowCount, rows: r.rows }, null, 2));
await c.end();
