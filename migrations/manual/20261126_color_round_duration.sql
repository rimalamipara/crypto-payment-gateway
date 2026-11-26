-- Wingo/color game sessions: 1, 3, 5 and 10 minute rooms.
-- Existing rounds were all 3-minute, which the default preserves.
-- Mirrors ColorRound.durationSec in src/prisma/contract.prisma. Additive and idempotent.

ALTER TABLE "ColorRound" ADD COLUMN IF NOT EXISTS "durationSec" INTEGER NOT NULL DEFAULT 180;
CREATE INDEX IF NOT EXISTS "ColorRound_durationSec_status_idx" ON "ColorRound" ("durationSec", "status");
