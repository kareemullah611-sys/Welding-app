DO $$ BEGIN
  CREATE TYPE "InvestmentParticipantActionType" AS ENUM (
    'profit_withdrawal',
    'capital_withdrawal',
    'mixed_withdrawal',
    'profit_reinvestment',
    'full_exit',
    'reversal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestmentParticipantActionStatus" AS ENUM ('active', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestmentParticipantActionLedgerCategory" AS ENUM (
    'finalized_profit_withdrawal',
    'capital_withdrawal',
    'profit_reinvestment',
    'full_exit_profit',
    'full_exit_capital',
    'reversal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "investment_participant_actions" (
  "id" SERIAL PRIMARY KEY,
  "participant_id" INTEGER NOT NULL,
  "action_type" "InvestmentParticipantActionType" NOT NULL,
  "status" "InvestmentParticipantActionStatus" NOT NULL DEFAULT 'active',
  "profit_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "capital_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "effective_date" DATE NOT NULL,
  "old_capital_pkr" DECIMAL(15,2) NOT NULL,
  "new_capital_pkr" DECIMAL(15,2) NOT NULL,
  "old_available_profit_pkr" DECIMAL(15,2) NOT NULL,
  "new_available_profit_pkr" DECIMAL(15,2) NOT NULL,
  "finalized_profit_sources_json" JSONB,
  "confirmation_reference" VARCHAR(240) NOT NULL,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "remarks" TEXT,
  "reversal_of_action_id" INTEGER,
  "reversal_reason" TEXT,
  "capital_event_id" INTEGER,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "investment_participant_actions_idempotency_key_key" ON "investment_participant_actions" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "investment_participant_actions_capital_event_id_key" ON "investment_participant_actions" ("capital_event_id") WHERE "capital_event_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "investment_participant_actions_participant_date_idx" ON "investment_participant_actions" ("participant_id", "effective_date");
CREATE INDEX IF NOT EXISTS "investment_participant_actions_type_idx" ON "investment_participant_actions" ("action_type");
CREATE INDEX IF NOT EXISTS "investment_participant_actions_status_idx" ON "investment_participant_actions" ("status");
CREATE INDEX IF NOT EXISTS "investment_participant_actions_reversal_of_idx" ON "investment_participant_actions" ("reversal_of_action_id");

DO $$ BEGIN
  ALTER TABLE "investment_participant_actions"
    ADD CONSTRAINT "investment_participant_actions_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_actions"
    ADD CONSTRAINT "investment_participant_actions_reversal_of_action_id_fkey"
    FOREIGN KEY ("reversal_of_action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_actions"
    ADD CONSTRAINT "investment_participant_actions_capital_event_id_fkey"
    FOREIGN KEY ("capital_event_id") REFERENCES "investment_capital_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "investment_participant_action_ledger_entries" (
  "id" SERIAL PRIMARY KEY,
  "action_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "category" "InvestmentParticipantActionLedgerCategory" NOT NULL,
  "amount_pkr" DECIMAL(15,2) NOT NULL,
  "debit_account" VARCHAR(160) NOT NULL,
  "credit_account" VARCHAR(160) NOT NULL,
  "source_finalization_ids" JSONB,
  "reconciliation_reference" VARCHAR(240) NOT NULL,
  "reversal_of_entry_id" INTEGER,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "investment_participant_action_ledger_action_ref_key" ON "investment_participant_action_ledger_entries" ("action_id", "reconciliation_reference");
CREATE INDEX IF NOT EXISTS "investment_participant_action_ledger_participant_idx" ON "investment_participant_action_ledger_entries" ("participant_id");
CREATE INDEX IF NOT EXISTS "investment_participant_action_ledger_category_idx" ON "investment_participant_action_ledger_entries" ("category");
CREATE INDEX IF NOT EXISTS "investment_participant_action_ledger_reversal_idx" ON "investment_participant_action_ledger_entries" ("reversal_of_entry_id");

DO $$ BEGIN
  ALTER TABLE "investment_participant_action_ledger_entries"
    ADD CONSTRAINT "investment_participant_action_ledger_entries_action_id_fkey"
    FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_action_ledger_entries"
    ADD CONSTRAINT "investment_participant_action_ledger_entries_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_action_ledger_entries"
    ADD CONSTRAINT "investment_participant_action_ledger_entries_reversal_of_entry_id_fkey"
    FOREIGN KEY ("reversal_of_entry_id") REFERENCES "investment_participant_action_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
