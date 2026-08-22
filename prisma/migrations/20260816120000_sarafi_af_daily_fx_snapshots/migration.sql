-- Sarafi.af daily FX snapshots: additive audit tables only.
-- Existing accounting, ledger, payment, sale, and investor rows are not modified.

CREATE TABLE IF NOT EXISTS "sarafi_af_fx_snapshots" (
  "id" SERIAL PRIMARY KEY,
  "snapshot_date" DATE NOT NULL,
  "scheduled_time" VARCHAR(20) NOT NULL DEFAULT '08:30',
  "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kabul',
  "provider" VARCHAR(80) NOT NULL DEFAULT 'SARAFI_AF',
  "market" VARCHAR(120) NOT NULL DEFAULT 'sarai_shahzada',
  "provider_mode" VARCHAR(80) NOT NULL DEFAULT 'FOUNDATION_ONLY',
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "source_timestamp" TIMESTAMP(3),
  "source_age_minutes" INTEGER,
  "status" VARCHAR(80) NOT NULL,
  "raw_reference" VARCHAR(240),
  "raw_payload_hash" VARCHAR(120),
  "validation_warnings_json" JSONB,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "sarafi_af_fx_snapshot_quotes" (
  "id" SERIAL PRIMARY KEY,
  "snapshot_id" INTEGER NOT NULL,
  "base_currency_id" INTEGER NOT NULL,
  "quote_currency_id" INTEGER NOT NULL,
  "raw_buy_rate" DECIMAL(18,8) NOT NULL,
  "raw_sell_rate" DECIMAL(18,8) NOT NULL,
  "raw_unit" VARCHAR(40) NOT NULL DEFAULT '1',
  "normalization_factor" DECIMAL(18,8) NOT NULL DEFAULT 1,
  "normalized_buy_rate" DECIMAL(18,8) NOT NULL,
  "normalized_sell_rate" DECIMAL(18,8) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "sarafi_af_fx_derived_rates" (
  "id" SERIAL PRIMARY KEY,
  "snapshot_id" INTEGER NOT NULL,
  "from_currency_id" INTEGER NOT NULL,
  "to_currency_id" INTEGER NOT NULL,
  "buy_rate" DECIMAL(18,8) NOT NULL,
  "sell_rate" DECIMAL(18,8) NOT NULL,
  "conversion_path_json" JSONB NOT NULL,
  "source_rates_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_fx_snapshots_daily_key"
  ON "sarafi_af_fx_snapshots"("snapshot_date", "provider", "market", "scheduled_time");
CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_fx_snapshots_idempotency_key_key"
  ON "sarafi_af_fx_snapshots"("idempotency_key");
CREATE INDEX IF NOT EXISTS "sarafi_af_fx_snapshots_date_status_idx"
  ON "sarafi_af_fx_snapshots"("snapshot_date", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_fx_snapshot_quotes_pair_key"
  ON "sarafi_af_fx_snapshot_quotes"("snapshot_id", "base_currency_id", "quote_currency_id");
CREATE INDEX IF NOT EXISTS "sarafi_af_fx_snapshot_quotes_currency_idx"
  ON "sarafi_af_fx_snapshot_quotes"("base_currency_id", "quote_currency_id");

CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_fx_derived_rates_pair_key"
  ON "sarafi_af_fx_derived_rates"("snapshot_id", "from_currency_id", "to_currency_id");
CREATE INDEX IF NOT EXISTS "sarafi_af_fx_derived_rates_currency_idx"
  ON "sarafi_af_fx_derived_rates"("from_currency_id", "to_currency_id");

ALTER TABLE "sarafi_af_fx_snapshot_quotes"
  ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "sarafi_af_fx_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sarafi_af_fx_snapshot_quotes"
  ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_base_currency_id_fkey"
  FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sarafi_af_fx_snapshot_quotes"
  ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_quote_currency_id_fkey"
  FOREIGN KEY ("quote_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sarafi_af_fx_derived_rates"
  ADD CONSTRAINT "sarafi_af_fx_derived_rates_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "sarafi_af_fx_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sarafi_af_fx_derived_rates"
  ADD CONSTRAINT "sarafi_af_fx_derived_rates_from_currency_id_fkey"
  FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sarafi_af_fx_derived_rates"
  ADD CONSTRAINT "sarafi_af_fx_derived_rates_to_currency_id_fkey"
  FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "fx_snapshot_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "fx_original_currency_code" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "fx_original_amount" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "fx_selected_rate" DECIMAL(18,6),
  ADD COLUMN IF NOT EXISTS "fx_selected_rate_type" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "fx_provider" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "fx_provider_reference" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "fx_pkr_equivalent" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "fx_conversion_path_json" JSONB;

CREATE INDEX IF NOT EXISTS "sales_fx_snapshot_idx" ON "sales"("fx_snapshot_id");

ALTER TABLE "investment_participant_settlement_payments"
  ADD COLUMN IF NOT EXISTS "fx_snapshot_id" INTEGER;

CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_fx_snapshot_idx"
  ON "investment_participant_settlement_payments"("fx_snapshot_id");
