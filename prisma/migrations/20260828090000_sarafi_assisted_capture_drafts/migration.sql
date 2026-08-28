-- Sarafi.af assisted capture drafts: additive review-only evidence storage.
-- No existing FX, accounting, investor, ledger, payment, or transaction rows are modified.

CREATE TABLE IF NOT EXISTS "sarafi_af_assisted_capture_drafts" (
  "id" SERIAL PRIMARY KEY,
  "snapshot_date" DATE NOT NULL,
  "scheduled_time" VARCHAR(20) NOT NULL DEFAULT '08:30',
  "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kabul',
  "provider" VARCHAR(80) NOT NULL DEFAULT 'SARAFI_AF',
  "market" VARCHAR(120) NOT NULL DEFAULT 'sarai_shahzada',
  "source_url" VARCHAR(500) NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "source_timestamp" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(80) NOT NULL DEFAULT 'PENDING_REVIEW',
  "raw_payload_hash" VARCHAR(64) NOT NULL,
  "raw_html_storage_key" VARCHAR(500) NOT NULL,
  "screenshot_storage_key" VARCHAR(500) NOT NULL,
  "quotes_json" JSONB NOT NULL,
  "validation_warnings_json" JSONB,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "reviewed_by" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "review_notes" TEXT,
  "approved_snapshot_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_assisted_capture_drafts_idempotency_key_key"
  ON "sarafi_af_assisted_capture_drafts"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "sarafi_af_assisted_capture_drafts_approved_snapshot_id_key"
  ON "sarafi_af_assisted_capture_drafts"("approved_snapshot_id");
CREATE INDEX IF NOT EXISTS "sarafi_af_capture_drafts_date_status_idx"
  ON "sarafi_af_assisted_capture_drafts"("snapshot_date", "status");
