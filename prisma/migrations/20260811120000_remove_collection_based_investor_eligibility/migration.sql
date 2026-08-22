ALTER TABLE "profit_attribution_periods"
  DROP COLUMN IF EXISTS "distribution_eligible_profit_pkr",
  DROP COLUMN IF EXISTS "pending_collection_profit_pkr";
