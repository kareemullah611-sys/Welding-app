DO $$ BEGIN
  CREATE TYPE "InvestmentParticipantSettlementStatus" AS ENUM ('unsettled', 'partially_settled', 'settled', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "investment_participant_actions"
  ADD COLUMN IF NOT EXISTS "settled_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "remaining_settlement_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settlement_status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'unsettled';

CREATE INDEX IF NOT EXISTS "investment_participant_actions_settlement_status_idx" ON "investment_participant_actions" ("settlement_status");

CREATE TABLE IF NOT EXISTS "investment_participant_settlements" (
  "id" SERIAL PRIMARY KEY,
  "action_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'unsettled',
  "currency_id" INTEGER NOT NULL,
  "settlement_amount" DECIMAL(15,2) NOT NULL,
  "pkr_equivalent" DECIMAL(15,2) NOT NULL,
  "exchange_rate" DECIMAL(15,6),
  "rate_source" VARCHAR(120),
  "rate_date" DATE,
  "payment_date" DATE NOT NULL,
  "payment_reference" VARCHAR(240) NOT NULL,
  "payment_method" VARCHAR(80) NOT NULL,
  "bank_cash_account" VARCHAR(200),
  "idempotency_key" VARCHAR(240) NOT NULL,
  "reversal_of_settlement_id" INTEGER,
  "reversal_reason" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "investment_participant_settlements_idempotency_key_key" ON "investment_participant_settlements" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "investment_participant_settlements_action_idx" ON "investment_participant_settlements" ("action_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlements_participant_idx" ON "investment_participant_settlements" ("participant_id");
CREATE INDEX IF NOT EXISTS "investment_participant_settlements_status_idx" ON "investment_participant_settlements" ("status");
CREATE INDEX IF NOT EXISTS "investment_participant_settlements_payment_date_idx" ON "investment_participant_settlements" ("payment_date");
CREATE INDEX IF NOT EXISTS "investment_participant_settlements_reversal_idx" ON "investment_participant_settlements" ("reversal_of_settlement_id");

DO $$ BEGIN
  ALTER TABLE "investment_participant_settlements"
    ADD CONSTRAINT "investment_participant_settlements_action_id_fkey"
    FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_settlements"
    ADD CONSTRAINT "investment_participant_settlements_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_settlements"
    ADD CONSTRAINT "investment_participant_settlements_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participant_settlements"
    ADD CONSTRAINT "investment_participant_settlements_reversal_of_settlement_id_fkey"
    FOREIGN KEY ("reversal_of_settlement_id") REFERENCES "investment_participant_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
