ALTER TABLE "city_transfers"
ADD COLUMN IF NOT EXISTS "batch_id" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "city_transfers_batch_id_idx"
ON "city_transfers"("batch_id");
