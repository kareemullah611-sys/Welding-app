DO $$ BEGIN
  CREATE TYPE "ExchangeRateEntryMethod" AS ENUM ('manual', 'api');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestmentParticipantType" AS ENUM ('manager', 'investor');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestmentCapitalEventType" AS ENUM ('opening', 'capital_contribution', 'capital_withdrawal', 'profit_reinvestment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProfitAttributionPeriodStatus" AS ENUM ('preview', 'finalized', 'voided');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" SERIAL NOT NULL,
  "rate_date" DATE NOT NULL,
  "from_currency_id" INTEGER NOT NULL,
  "to_currency_id" INTEGER NOT NULL,
  "buy_rate" DECIMAL(18, 6),
  "sell_rate" DECIMAL(18, 6),
  "reference_rate" DECIMAL(18, 6) NOT NULL,
  "source" VARCHAR(100) NOT NULL DEFAULT 'manual_open_market',
  "entry_method" "ExchangeRateEntryMethod" NOT NULL DEFAULT 'manual',
  "correction_of_id" INTEGER,
  "notes" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "investment_participants" (
  "id" SERIAL NOT NULL,
  "investor_id" INTEGER,
  "name" VARCHAR(200) NOT NULL,
  "type" "InvestmentParticipantType" NOT NULL DEFAULT 'investor',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "exited_at" DATE,
  "notes" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investment_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "investment_capital_events" (
  "id" SERIAL NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "event_type" "InvestmentCapitalEventType" NOT NULL,
  "amount_pkr" DECIMAL(15, 2) NOT NULL,
  "effective_date" DATE NOT NULL,
  "investor_profit_share_percent" DECIMAL(6, 3),
  "manager_profit_share_percent" DECIMAL(6, 3),
  "source_type" VARCHAR(80),
  "source_id" INTEGER,
  "reason" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investment_capital_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "profit_attribution_periods" (
  "id" SERIAL NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "status" "ProfitAttributionPeriodStatus" NOT NULL DEFAULT 'preview',
  "business_profit_pkr" DECIMAL(15, 2) NOT NULL,
  "distribution_eligible_profit_pkr" DECIMAL(15, 2),
  "pending_collection_profit_pkr" DECIMAL(15, 2),
  "total_attributed_pkr" DECIMAL(15, 2) NOT NULL,
  "reconciliation_difference_pkr" DECIMAL(15, 2) NOT NULL,
  "reconciliation_status" VARCHAR(30) NOT NULL,
  "finalization_disabled_reasons" JSONB,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profit_attribution_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "profit_attribution_lines" (
  "id" SERIAL NOT NULL,
  "period_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "segment_start" DATE NOT NULL,
  "segment_end" DATE NOT NULL,
  "capital_pkr" DECIMAL(15, 2) NOT NULL,
  "capital_percent" DECIMAL(9, 6) NOT NULL,
  "pool_profit_pkr" DECIMAL(15, 2) NOT NULL,
  "attributable_pkr" DECIMAL(15, 2) NOT NULL,
  "investor_profit_share_percent" DECIMAL(6, 3) NOT NULL,
  "investor_entitlement_pkr" DECIMAL(15, 2) NOT NULL,
  "manager_share_pkr" DECIMAL(15, 2) NOT NULL,
  "allocated_loss_pkr" DECIMAL(15, 2) NOT NULL,
  "total_attributed_pkr" DECIMAL(15, 2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profit_attribution_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "investor_residual_attributions" (
  "id" SERIAL NOT NULL,
  "period_id" INTEGER NOT NULL,
  "original_participant_id" INTEGER NOT NULL,
  "manager_participant_id" INTEGER NOT NULL,
  "source_type" VARCHAR(80) NOT NULL,
  "source_id" INTEGER,
  "original_capital_percent" DECIMAL(9, 6) NOT NULL,
  "original_attributable_pkr" DECIMAL(15, 2) NOT NULL,
  "manager_assumption_pkr" DECIMAL(15, 2) NOT NULL,
  "posting_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investor_residual_attributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_date_currency_source_key"
  ON "exchange_rates" ("rate_date", "from_currency_id", "to_currency_id", "source");
CREATE INDEX IF NOT EXISTS "exchange_rates_currency_date_idx"
  ON "exchange_rates" ("from_currency_id", "to_currency_id", "rate_date");
CREATE INDEX IF NOT EXISTS "investment_participants_investor_id_idx"
  ON "investment_participants" ("investor_id");
CREATE INDEX IF NOT EXISTS "investment_participants_type_idx"
  ON "investment_participants" ("type");
CREATE INDEX IF NOT EXISTS "investment_participants_is_active_idx"
  ON "investment_participants" ("is_active");
CREATE INDEX IF NOT EXISTS "investment_capital_events_participant_date_idx"
  ON "investment_capital_events" ("participant_id", "effective_date");
CREATE INDEX IF NOT EXISTS "investment_capital_events_effective_date_idx"
  ON "investment_capital_events" ("effective_date");
CREATE INDEX IF NOT EXISTS "profit_attribution_periods_period_idx"
  ON "profit_attribution_periods" ("period_start", "period_end");
CREATE INDEX IF NOT EXISTS "profit_attribution_periods_status_idx"
  ON "profit_attribution_periods" ("status");
CREATE INDEX IF NOT EXISTS "profit_attribution_lines_period_idx"
  ON "profit_attribution_lines" ("period_id");
CREATE INDEX IF NOT EXISTS "profit_attribution_lines_participant_idx"
  ON "profit_attribution_lines" ("participant_id");
CREATE INDEX IF NOT EXISTS "investor_residual_attributions_period_idx"
  ON "investor_residual_attributions" ("period_id");
CREATE INDEX IF NOT EXISTS "investor_residual_attributions_original_idx"
  ON "investor_residual_attributions" ("original_participant_id");

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_id_fkey"
    FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_id_fkey"
    FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_correction_of_id_fkey"
    FOREIGN KEY ("correction_of_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_participants" ADD CONSTRAINT "investment_participants_investor_id_fkey"
    FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investment_capital_events" ADD CONSTRAINT "investment_capital_events_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profit_attribution_lines" ADD CONSTRAINT "profit_attribution_lines_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profit_attribution_lines" ADD CONSTRAINT "profit_attribution_lines_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_original_participant_id_fkey"
    FOREIGN KEY ("original_participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_manager_participant_id_fkey"
    FOREIGN KEY ("manager_participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
