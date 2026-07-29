ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "portal_access_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "portal_username" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "portal_password_hash" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "portal_last_login_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_portal_username_key"
  ON "customers"("portal_username")
  WHERE "portal_username" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "customers_portal_access_enabled_idx"
  ON "customers"("portal_access_enabled");
