ALTER TABLE "lot_purchases"
  ADD COLUMN "carrying_rate_pkr" DECIMAL(12,6),
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "recognition_date" DATE,
  ADD COLUMN "recognition_rate_metadata" JSONB,
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "super_admin_personal_expenses"
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "journal_entries"
  ADD COLUMN "line_number" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY transaction_id ORDER BY id)::INTEGER AS line_number
  FROM journal_entries
)
UPDATE journal_entries AS target
SET line_number = numbered.line_number
FROM numbered
WHERE target.id = numbered.id;

ALTER TABLE "journal_entries"
  ALTER COLUMN "line_number" SET NOT NULL;

CREATE UNIQUE INDEX "journal_entries_transaction_line_key"
  ON "journal_entries"("transaction_id", "line_number");
