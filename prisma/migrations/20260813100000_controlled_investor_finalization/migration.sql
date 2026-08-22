DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProfitAttributionPeriodStatus'
      AND e.enumlabel = 'reversed'
  ) THEN
    ALTER TYPE "ProfitAttributionPeriodStatus" ADD VALUE 'reversed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvestorAttributionLedgerCategory') THEN
    CREATE TYPE "InvestorAttributionLedgerCategory" AS ENUM (
      'investor_profit',
      'investor_capital_loss',
      'manager_own_capital',
      'manager_profit_share',
      'manager_residual'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvestorAttributionLedgerEntryType') THEN
    CREATE TYPE "InvestorAttributionLedgerEntryType" AS ENUM ('finalization', 'reversal');
  END IF;
END $$;

ALTER TABLE "profit_attribution_periods"
  ADD COLUMN IF NOT EXISTS "source_report_reference" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "snapshot_json" JSONB,
  ADD COLUMN IF NOT EXISTS "posting_simulation_json" JSONB,
  ADD COLUMN IF NOT EXISTS "finalized_by" INTEGER,
  ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversed_by" INTEGER,
  ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "reversal_of_period_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "reconciliation_reference" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(240);

CREATE UNIQUE INDEX IF NOT EXISTS "profit_attribution_periods_idempotency_key_key"
  ON "profit_attribution_periods"("idempotency_key");

CREATE INDEX IF NOT EXISTS "profit_attribution_periods_reversal_of_idx"
  ON "profit_attribution_periods"("reversal_of_period_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profit_attribution_periods_reversal_of_fkey'
  ) THEN
    ALTER TABLE "profit_attribution_periods"
      ADD CONSTRAINT "profit_attribution_periods_reversal_of_fkey"
      FOREIGN KEY ("reversal_of_period_id")
      REFERENCES "profit_attribution_periods"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "investor_attribution_ledger_entries" (
  "id" SERIAL PRIMARY KEY,
  "period_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "category" "InvestorAttributionLedgerCategory" NOT NULL,
  "entry_type" "InvestorAttributionLedgerEntryType" NOT NULL,
  "amount_pkr" DECIMAL(15, 2) NOT NULL,
  "debit_account" VARCHAR(160) NOT NULL,
  "credit_account" VARCHAR(160) NOT NULL,
  "source_pool" VARCHAR(500),
  "source_attribution_line" VARCHAR(200),
  "posting_type" VARCHAR(120) NOT NULL,
  "reconciliation_reference" VARCHAR(240) NOT NULL,
  "reversal_of_entry_id" INTEGER,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investor_attribution_ledger_entries_period_fkey"
    FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investor_attribution_ledger_entries_participant_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investor_attribution_ledger_entries_reversal_fkey"
    FOREIGN KEY ("reversal_of_entry_id") REFERENCES "investor_attribution_ledger_entries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "investor_attr_ledger_period_ref_type_key"
  ON "investor_attribution_ledger_entries"("period_id", "reconciliation_reference", "entry_type");

CREATE INDEX IF NOT EXISTS "investor_attr_ledger_period_idx"
  ON "investor_attribution_ledger_entries"("period_id");

CREATE INDEX IF NOT EXISTS "investor_attr_ledger_participant_idx"
  ON "investor_attribution_ledger_entries"("participant_id");

CREATE INDEX IF NOT EXISTS "investor_attr_ledger_category_idx"
  ON "investor_attribution_ledger_entries"("category");

CREATE INDEX IF NOT EXISTS "investor_attr_ledger_reversal_idx"
  ON "investor_attribution_ledger_entries"("reversal_of_entry_id");
