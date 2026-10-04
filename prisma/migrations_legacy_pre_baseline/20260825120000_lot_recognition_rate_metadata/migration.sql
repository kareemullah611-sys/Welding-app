ALTER TABLE "lots"
ADD COLUMN IF NOT EXISTS "pkr_exchange_rate_metadata" JSONB;
