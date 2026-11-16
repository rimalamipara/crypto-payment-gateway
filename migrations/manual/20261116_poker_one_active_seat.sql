-- Proposal A: one non-left poker seat per user.
-- Canonical index name: poker_seat_one_active_per_user
-- Application detects races via PostgreSQL SQLSTATE 23505 (not by index name).
--
-- IMPORTANT:
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--   On failure it can leave an INVALID index; IF NOT EXISTS then skips forever.
--
-- ── 1) Audit (must return 0 rows before creating the index) ─────────────────
SELECT "userId",
       COUNT(*)::int AS seats,
       array_agg("tableId" ORDER BY "tableId") AS table_ids,
       array_agg(status) AS statuses
FROM "PokerSeat"
WHERE status <> 'left'
GROUP BY "userId"
HAVING COUNT(*) > 1
ORDER BY "userId";

-- If rows appear: resolve manually (cash out extras), then re-run the audit.

-- ── 2) Create index (outside any transaction) ───────────────────────────────
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS poker_seat_one_active_per_user
ON "PokerSeat" ("userId")
WHERE status <> 'left';

-- ── 3) Verify the index is VALID ────────────────────────────────────────────
SELECT indexrelid::regclass AS index_name,
       indisvalid,
       indisready
FROM pg_index
WHERE indexrelid = 'poker_seat_one_active_per_user'::regclass;

-- Expect: indisvalid = true, indisready = true.
--
-- ── Recovery if INVALID ─────────────────────────────────────────────────────
-- DROP INDEX CONCURRENTLY IF EXISTS poker_seat_one_active_per_user;
-- Fix any duplicate active seats (re-run audit).
-- Re-run CREATE UNIQUE INDEX CONCURRENTLY … then the SELECT above again.
