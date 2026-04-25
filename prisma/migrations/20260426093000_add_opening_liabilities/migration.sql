-- Create enum
CREATE TYPE "OpeningLiabilityType" AS ENUM ('supplier', 'shipping_line', 'agent', 'intermediary');

-- Create table
CREATE TABLE "opening_liabilities" (
  "id" SERIAL NOT NULL,
  "liability_type" "OpeningLiabilityType" NOT NULL,
  "supplier_id" INTEGER,
  "shipping_line_id" INTEGER,
  "agent_id" INTEGER,
  "intermediary_id" INTEGER,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_liabilities_pkey" PRIMARY KEY ("id")
);

-- Constraints
CREATE UNIQUE INDEX "unique_opening_liability_supplier_currency"
  ON "opening_liabilities"("supplier_id", "currency_id");
CREATE UNIQUE INDEX "unique_opening_liability_shipping_line_currency"
  ON "opening_liabilities"("shipping_line_id", "currency_id");
CREATE UNIQUE INDEX "unique_opening_liability_agent_currency"
  ON "opening_liabilities"("agent_id", "currency_id");
CREATE UNIQUE INDEX "unique_opening_liability_intermediary_currency"
  ON "opening_liabilities"("intermediary_id", "currency_id");

CREATE INDEX "opening_liabilities_liability_type_idx" ON "opening_liabilities"("liability_type");
CREATE INDEX "opening_liabilities_opening_date_idx" ON "opening_liabilities"("opening_date");

ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_shipping_line_id_fkey"
  FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_intermediary_id_fkey"
  FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
