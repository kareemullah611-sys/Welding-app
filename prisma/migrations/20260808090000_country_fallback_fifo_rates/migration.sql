-- Country-level fallback rates for provisional PKR reporting.
CREATE TABLE "country_fallback_exchange_rates" (
  "id" SERIAL NOT NULL,
  "country_id" INTEGER NOT NULL,
  "from_currency_id" INTEGER NOT NULL,
  "to_currency_id" INTEGER NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "effective_from" DATE NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "country_fallback_exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "country_fallback_rates_country_currency_date_key"
  ON "country_fallback_exchange_rates"("country_id", "from_currency_id", "to_currency_id", "effective_from");
CREATE INDEX "country_fallback_rates_active_idx"
  ON "country_fallback_exchange_rates"("country_id", "from_currency_id", "to_currency_id", "is_active");

ALTER TABLE "country_fallback_exchange_rates"
  ADD CONSTRAINT "country_fallback_exchange_rates_country_id_fkey"
  FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "country_fallback_exchange_rates"
  ADD CONSTRAINT "country_fallback_exchange_rates_from_currency_id_fkey"
  FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "country_fallback_exchange_rates"
  ADD CONSTRAINT "country_fallback_exchange_rates_to_currency_id_fkey"
  FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "country_fallback_exchange_rates"
  ADD CONSTRAINT "country_fallback_exchange_rates_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FIFO USD acquisition layers held by intermediaries.
CREATE TABLE "intermediary_usd_cost_layers" (
  "id" SERIAL NOT NULL,
  "intermediary_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "source_type" VARCHAR(50) NOT NULL,
  "source_id" INTEGER NOT NULL,
  "acquired_date" DATE NOT NULL,
  "original_amount_usd" DECIMAL(15,2) NOT NULL,
  "remaining_amount_usd" DECIMAL(15,2) NOT NULL,
  "original_cost_pkr" DECIMAL(15,2) NOT NULL,
  "remaining_cost_pkr" DECIMAL(15,2) NOT NULL,
  "rate_pkr" DECIMAL(18,6) NOT NULL,
  "is_fallback_rate" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intermediary_usd_cost_layers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intermediary_usd_layers_source_key"
  ON "intermediary_usd_cost_layers"("source_type", "source_id");
CREATE INDEX "intermediary_usd_layers_balance_idx"
  ON "intermediary_usd_cost_layers"("intermediary_id", "remaining_amount_usd");
CREATE INDEX "intermediary_usd_layers_date_idx"
  ON "intermediary_usd_cost_layers"("acquired_date");

ALTER TABLE "intermediary_usd_cost_layers"
  ADD CONSTRAINT "intermediary_usd_cost_layers_intermediary_id_fkey"
  FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intermediary_usd_cost_layers"
  ADD CONSTRAINT "intermediary_usd_cost_layers_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exact FIFO consumption by supplier/shipping payments, including fallback chunks when legacy balance has no layer.
CREATE TABLE "intermediary_usd_cost_usages" (
  "id" SERIAL NOT NULL,
  "layer_id" INTEGER,
  "intermediary_id" INTEGER NOT NULL,
  "supplier_payment_id" INTEGER,
  "shipping_line_payment_id" INTEGER,
  "amount_usd" DECIMAL(15,2) NOT NULL,
  "cost_pkr" DECIMAL(15,2) NOT NULL,
  "rate_pkr" DECIMAL(18,6) NOT NULL,
  "is_fallback_rate" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intermediary_usd_cost_usages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intermediary_usd_usages_layer_idx" ON "intermediary_usd_cost_usages"("layer_id");
CREATE INDEX "intermediary_usd_usages_intermediary_idx" ON "intermediary_usd_cost_usages"("intermediary_id");
CREATE INDEX "intermediary_usd_usages_supplier_idx" ON "intermediary_usd_cost_usages"("supplier_payment_id");
CREATE INDEX "intermediary_usd_usages_shipping_idx" ON "intermediary_usd_cost_usages"("shipping_line_payment_id");

ALTER TABLE "intermediary_usd_cost_usages"
  ADD CONSTRAINT "intermediary_usd_cost_usages_layer_id_fkey"
  FOREIGN KEY ("layer_id") REFERENCES "intermediary_usd_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intermediary_usd_cost_usages"
  ADD CONSTRAINT "intermediary_usd_cost_usages_intermediary_id_fkey"
  FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intermediary_usd_cost_usages"
  ADD CONSTRAINT "intermediary_usd_cost_usages_supplier_payment_id_fkey"
  FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intermediary_usd_cost_usages"
  ADD CONSTRAINT "intermediary_usd_cost_usages_shipping_line_payment_id_fkey"
  FOREIGN KEY ("shipping_line_payment_id") REFERENCES "shipping_line_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
