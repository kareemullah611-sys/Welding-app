ALTER TYPE "InvestmentCapitalEventType" ADD VALUE IF NOT EXISTS 'full_exit';

ALTER TABLE "investment_capital_events"
  ALTER COLUMN "investor_profit_share_percent" TYPE DECIMAL(9, 6),
  ALTER COLUMN "manager_profit_share_percent" TYPE DECIMAL(9, 6);

CREATE TABLE IF NOT EXISTS "investment_profit_share_events" (
  "id" SERIAL NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "effective_date" DATE NOT NULL,
  "investor_profit_share_percent" DECIMAL(9, 6) NOT NULL,
  "manager_profit_share_percent" DECIMAL(9, 6) NOT NULL,
  "reference" VARCHAR(120),
  "remarks" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investment_profit_share_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "investment_profit_share_events_participant_date_idx"
  ON "investment_profit_share_events" ("participant_id", "effective_date");
CREATE INDEX IF NOT EXISTS "investment_profit_share_events_effective_date_idx"
  ON "investment_profit_share_events" ("effective_date");

DO $$ BEGIN
  ALTER TABLE "investment_profit_share_events" ADD CONSTRAINT "investment_profit_share_events_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "profit_attribution_lines"
  ALTER COLUMN "investor_profit_share_percent" TYPE DECIMAL(9, 6),
  ADD COLUMN IF NOT EXISTS "manager_profit_share_percent" DECIMAL(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "manager_own_capital_profit_pkr" DECIMAL(15, 2) NOT NULL DEFAULT 0;
