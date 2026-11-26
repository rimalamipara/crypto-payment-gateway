-- Phone + Google login identifiers on User. Additive and idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User" ("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User" ("googleId");
