ALTER TABLE "lot_costs"
ADD COLUMN IF NOT EXISTS "journal_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "investor_attribution_ledger_entries"
SET "posting_type" = CASE
  WHEN "debit_account" = 'Manager Capital' THEN 'manager_own_capital_loss'
  ELSE 'manager_own_capital_profit'
END
WHERE "category" = 'manager_own_capital'
  AND "posting_type" = 'manager_own_capital_result';

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profit_attribution_periods_no_finalized_overlap'
  ) THEN
    ALTER TABLE "profit_attribution_periods"
    ADD CONSTRAINT "profit_attribution_periods_no_finalized_overlap"
    EXCLUDE USING gist (
      daterange("period_start", "period_end", '[]') WITH &&
    )
    WHERE ("status" = 'finalized');
  END IF;
END $$;
