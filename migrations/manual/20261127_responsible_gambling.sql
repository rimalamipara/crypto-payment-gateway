-- Responsible gambling settings. Additive and idempotent. Mirrors contract model `ResponsibleGambling`.
CREATE TABLE IF NOT EXISTS "ResponsibleGambling" (
  "id"                   SERIAL PRIMARY KEY,
  "userId"               INTEGER     NOT NULL,
  "dailyDepositLimitUsd" NUMERIC,
  "dailyLossLimitUsd"    NUMERIC,
  "coolingOffUntil"      TIMESTAMPTZ,
  "selfExcludedUntil"    TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResponsibleGambling_userId_key" ON "ResponsibleGambling" ("userId");
