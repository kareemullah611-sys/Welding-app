-- Phase 3.2 settlement execution metadata.
-- Additive only: preserves existing settlement rows and all accounting tables.

ALTER TABLE "investment_participant_settlements"
  ADD COLUMN IF NOT EXISTS "profit_component_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "capital_component_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "selected_rate_type" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "provider_reference" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "conversion_path_json" JSONB;
