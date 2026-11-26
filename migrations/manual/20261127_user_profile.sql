-- Profile fields on User. Additive and idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
