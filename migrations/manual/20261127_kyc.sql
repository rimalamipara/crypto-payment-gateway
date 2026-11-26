-- KYC submissions. Additive and idempotent. Mirrors contract model `Kyc`.
CREATE TABLE IF NOT EXISTS "Kyc" (
  "id"           SERIAL PRIMARY KEY,
  "userId"       INTEGER     NOT NULL,
  "status"       TEXT        NOT NULL DEFAULT 'pending',
  "fullName"     TEXT        NOT NULL,
  "dateOfBirth"  TEXT        NOT NULL,
  "country"      TEXT        NOT NULL,
  "docType"      TEXT        NOT NULL,
  "docNumber"    TEXT        NOT NULL,
  "docFrontUrl"  TEXT        NOT NULL,
  "docBackUrl"   TEXT,
  "selfieUrl"    TEXT        NOT NULL,
  "rejectReason" TEXT,
  "reviewedBy"   INTEGER,
  "reviewedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Kyc_userId_key" ON "Kyc" ("userId");
CREATE INDEX IF NOT EXISTS "Kyc_status_idx" ON "Kyc" ("status");
