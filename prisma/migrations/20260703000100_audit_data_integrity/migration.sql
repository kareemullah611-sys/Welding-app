ALTER TABLE "sync_requests"
  ADD CONSTRAINT "sync_requests_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "sync_requests"
  ADD CONSTRAINT "sync_requests_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

DROP INDEX IF EXISTS "unique_opening_liability_supplier_currency";
DROP INDEX IF EXISTS "unique_opening_liability_shipping_line_currency";
DROP INDEX IF EXISTS "unique_opening_liability_agent_currency";
DROP INDEX IF EXISTS "unique_opening_liability_intermediary_currency";

CREATE UNIQUE INDEX "unique_opening_liability_supplier_currency"
  ON "opening_liabilities"("supplier_id", "currency_id")
  WHERE "liability_type" = 'supplier' AND "supplier_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_opening_liability_shipping_line_currency"
  ON "opening_liabilities"("shipping_line_id", "currency_id")
  WHERE "liability_type" = 'shipping_line' AND "shipping_line_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_opening_liability_agent_currency"
  ON "opening_liabilities"("agent_id", "currency_id")
  WHERE "liability_type" = 'agent' AND "agent_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_opening_liability_intermediary_currency"
  ON "opening_liabilities"("intermediary_id", "currency_id")
  WHERE "liability_type" = 'intermediary' AND "intermediary_id" IS NOT NULL;

ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_party_type_check"
  CHECK (
    (
      "liability_type" = 'supplier'
      AND "supplier_id" IS NOT NULL
      AND "shipping_line_id" IS NULL
      AND "agent_id" IS NULL
      AND "intermediary_id" IS NULL
    )
    OR (
      "liability_type" = 'shipping_line'
      AND "supplier_id" IS NULL
      AND "shipping_line_id" IS NOT NULL
      AND "agent_id" IS NULL
      AND "intermediary_id" IS NULL
    )
    OR (
      "liability_type" = 'agent'
      AND "supplier_id" IS NULL
      AND "shipping_line_id" IS NULL
      AND "agent_id" IS NOT NULL
      AND "intermediary_id" IS NULL
    )
    OR (
      "liability_type" = 'intermediary'
      AND "supplier_id" IS NULL
      AND "shipping_line_id" IS NULL
      AND "agent_id" IS NULL
      AND "intermediary_id" IS NOT NULL
    )
  )
  NOT VALID;
