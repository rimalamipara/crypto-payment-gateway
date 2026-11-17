-- Admin on/off switch per game ("poker" | "teen-patti" | "rummy" | "color").
-- A game with no row is treated as enabled by the application.
--
-- Additive and idempotent: safe to run more than once, touches nothing else.
-- Mirrors the contract model `GameSetting` in src/prisma/contract.prisma and the
-- column conventions of existing tables (timestamptz, SERIAL id).
--
-- Why not `prisma db update`: the live database has columns the contract does not
-- list (e.g. ColorRound.seedHash / serverSeed / fairnessVersion), and the
-- migrations/manual directory makes the CLI refuse to run, so apply this file directly.

CREATE TABLE IF NOT EXISTS "GameSetting" (
  "id"        SERIAL PRIMARY KEY,
  "game"      TEXT        NOT NULL,
  "enabled"   BOOLEAN     NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameSetting_game_key" ON "GameSetting" ("game");
