-- In-app notifications. Additive and idempotent. Mirrors contract model `Notification`.
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER     NOT NULL,
  "type"      TEXT        NOT NULL,
  "title"     TEXT        NOT NULL,
  "body"      TEXT        NOT NULL,
  "read"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification" ("userId", "read");
