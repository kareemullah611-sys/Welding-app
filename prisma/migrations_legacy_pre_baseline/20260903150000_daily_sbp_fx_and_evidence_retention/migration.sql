-- Additive daily SBP FX capture and seven-day source-evidence retention.
-- Existing immutable FX rates and accounting transactions are not changed.

ALTER TABLE "sarafi_af_assisted_capture_drafts"
  ALTER COLUMN "raw_html_storage_key" DROP NOT NULL,
  ALTER COLUMN "screenshot_storage_key" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "evidence_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "evidence_deleted_at" TIMESTAMP(3);

UPDATE "sarafi_af_assisted_capture_drafts"
SET "evidence_expires_at" = "created_at" + INTERVAL '7 days'
WHERE "evidence_expires_at" IS NULL;

ALTER TABLE "sarafi_af_assisted_capture_drafts"
  ALTER COLUMN "evidence_expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "sarafi_af_capture_evidence_expiry_idx"
  ON "sarafi_af_assisted_capture_drafts"("evidence_expires_at", "evidence_deleted_at");

CREATE TABLE IF NOT EXISTS "sbp_daily_fx_snapshots" (
  "id" SERIAL NOT NULL,
  "rate_date" DATE NOT NULL,
  "provider" VARCHAR(80) NOT NULL DEFAULT 'SBP',
  "market" VARCHAR(120) NOT NULL DEFAULT 'weighted_average_customer',
  "source_url" VARCHAR(500) NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "buy_rate" DECIMAL(18,6) NOT NULL,
  "sell_rate" DECIMAL(18,6) NOT NULL,
  "reference_rate" DECIMAL(18,6) NOT NULL,
  "status" VARCHAR(80) NOT NULL,
  "raw_payload_hash" VARCHAR(64) NOT NULL,
  "raw_html_storage_key" VARCHAR(500),
  "screenshot_storage_key" VARCHAR(500),
  "evidence_expires_at" TIMESTAMP(3) NOT NULL,
  "evidence_deleted_at" TIMESTAMP(3),
  "exchange_rate_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sbp_daily_fx_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sbp_daily_fx_snapshots_exchange_rate_id_fkey"
    FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sbp_daily_fx_snapshots_exchange_rate_id_key"
  ON "sbp_daily_fx_snapshots"("exchange_rate_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sbp_daily_fx_snapshots_date_provider_market_key"
  ON "sbp_daily_fx_snapshots"("rate_date", "provider", "market");
CREATE INDEX IF NOT EXISTS "sbp_daily_fx_snapshots_date_status_idx"
  ON "sbp_daily_fx_snapshots"("rate_date", "status");
CREATE INDEX IF NOT EXISTS "sbp_daily_fx_snapshots_evidence_expiry_idx"
  ON "sbp_daily_fx_snapshots"("evidence_expires_at", "evidence_deleted_at");
