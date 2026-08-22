-- Phase 3.3 controlled investor settlement payment linkage.
-- Additive only: creates a non-P&L settlement payment table.

CREATE TABLE IF NOT EXISTS "investment_participant_settlement_payments" (
  "id" SERIAL PRIMARY KEY,
  "settlement_id" INTEGER NOT NULL,
  "action_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'settled',
  "super_admin_bank_account_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "payment_amount" DECIMAL(15,2) NOT NULL,
  "pkr_equivalent" DECIMAL(15,2) NOT NULL,
  "exchange_rate" DECIMAL(15,6),
  "rate_source" VARCHAR(120),
  "rate_date" DATE,
  "selected_rate_type" VARCHAR(40),
  "provider_reference" VARCHAR(240),
  "conversion_path_json" JSONB,
  "payment_date" DATE NOT NULL,
  "payment_reference" VARCHAR(240) NOT NULL,
  "payment_method" VARCHAR(80) NOT NULL,
  "remarks" TEXT,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "journal_transaction_id" VARCHAR(80),
  "reversal_of_payment_id" INTEGER,
  "reversal_reason" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "investment_participant_settlement_payments_idempotency_key_key"
  ON "investment_participant_settlement_payments"("idempotency_key");

CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_settlement_idx"
  ON "investment_participant_settlement_payments"("settlement_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_action_idx"
  ON "investment_participant_settlement_payments"("action_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_participant_idx"
  ON "investment_participant_settlement_payments"("participant_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_account_idx"
  ON "investment_participant_settlement_payments"("super_admin_bank_account_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_status_idx"
  ON "investment_participant_settlement_payments"("status");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_payment_date_idx"
  ON "investment_participant_settlement_payments"("payment_date");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_journal_txn_idx"
  ON "investment_participant_settlement_payments"("journal_transaction_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlement_payments_reversal_idx"
  ON "investment_participant_settlement_payments"("reversal_of_payment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_settlement_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_settlement_fkey"
      FOREIGN KEY ("settlement_id") REFERENCES "investment_participant_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_action_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_action_fkey"
      FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_participant_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_participant_fkey"
      FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_account_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_account_fkey"
      FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_currency_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_currency_fkey"
      FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_participant_settlement_payments_reversal_fkey'
  ) THEN
    ALTER TABLE "investment_participant_settlement_payments"
      ADD CONSTRAINT "investment_participant_settlement_payments_reversal_fkey"
      FOREIGN KEY ("reversal_of_payment_id") REFERENCES "investment_participant_settlement_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
