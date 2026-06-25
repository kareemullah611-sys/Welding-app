ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "is_legacy_stock" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "lots_is_legacy_stock_idx" ON "lots"("is_legacy_stock");
