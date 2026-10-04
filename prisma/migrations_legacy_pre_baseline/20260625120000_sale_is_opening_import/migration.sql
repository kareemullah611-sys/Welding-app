ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "is_opening_import" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "sales_is_opening_import_idx" ON "sales"("is_opening_import");
