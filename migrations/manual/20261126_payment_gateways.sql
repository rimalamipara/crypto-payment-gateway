-- Admin on/off switch per payment gateway ("oxapay"). No row = enabled.
-- Additive and idempotent. Mirrors contract model `PaymentGateway`; apply directly
-- (see 20261117_game_settings.sql for why `prisma db update` is not used).

CREATE TABLE IF NOT EXISTS "PaymentGateway" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT        NOT NULL,
  "enabled"   BOOLEAN     NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentGateway_name_key" ON "PaymentGateway" ("name");
