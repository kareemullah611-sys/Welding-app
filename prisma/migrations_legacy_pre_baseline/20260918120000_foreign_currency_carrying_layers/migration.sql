CREATE TYPE "ForeignCurrencyPositionKind" AS ENUM ('asset', 'liability');
CREATE TYPE "ForeignCurrencyPositionType" AS ENUM ('customer_receivable', 'city_cash', 'city_bank', 'super_admin_cash', 'super_admin_bank', 'intermediary_balance', 'supplier_payable', 'shipping_payable', 'other_receivable', 'other_payable');
CREATE TYPE "ForeignCurrencyLayerStatus" AS ENUM ('open', 'closed', 'reversed');
CREATE TYPE "ForeignCurrencyMovementType" AS ENUM ('recognition', 'transfer', 'settlement', 'exchange', 'revaluation', 'reversal');

CREATE TABLE "foreign_currency_carrying_layers" (
    "id" SERIAL NOT NULL,
    "position_kind" "ForeignCurrencyPositionKind" NOT NULL,
    "position_type" "ForeignCurrencyPositionType" NOT NULL,
    "owner_key" VARCHAR(160) NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "source_line_key" VARCHAR(80) NOT NULL DEFAULT 'main',
    "recognition_date" DATE NOT NULL,
    "historical_pool_date" DATE NOT NULL,
    "original_foreign_amount" DECIMAL(18,4) NOT NULL,
    "remaining_foreign_amount" DECIMAL(18,4) NOT NULL,
    "original_carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
    "remaining_carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
    "recognition_rate_pkr" DECIMAL(18,8) NOT NULL,
    "rate_type" VARCHAR(40) NOT NULL,
    "rate_provider" VARCHAR(120) NOT NULL,
    "rate_reference" VARCHAR(240),
    "conversion_path_json" JSONB,
    "parent_layer_id" INTEGER,
    "status" "ForeignCurrencyLayerStatus" NOT NULL DEFAULT 'open',
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "foreign_currency_carrying_layers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "foreign_currency_movements" (
    "id" SERIAL NOT NULL,
    "movement_type" "ForeignCurrencyMovementType" NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "source_line_key" VARCHAR(80) NOT NULL DEFAULT 'main',
    "movement_date" DATE NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "source_layer_id" INTEGER,
    "target_layer_id" INTEGER,
    "foreign_amount" DECIMAL(18,4) NOT NULL,
    "carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
    "settlement_amount_pkr" DECIMAL(18,2),
    "realized_fx_pkr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "historical_pool_date" DATE NOT NULL,
    "rate_pkr" DECIMAL(18,8),
    "rate_type" VARCHAR(40),
    "rate_provider" VARCHAR(120),
    "rate_reference" VARCHAR(240),
    "conversion_path_json" JSONB,
    "journal_transaction_id" VARCHAR(120),
    "reversal_of_id" INTEGER,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foreign_currency_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "foreign_currency_layers_source_key" ON "foreign_currency_carrying_layers"("source_type", "source_id", "source_line_key");
CREATE INDEX "foreign_currency_layers_owner_balance_idx" ON "foreign_currency_carrying_layers"("owner_key", "currency_id", "status", "recognition_date");
CREATE INDEX "foreign_currency_layers_pool_date_idx" ON "foreign_currency_carrying_layers"("historical_pool_date");
CREATE INDEX "foreign_currency_layers_parent_idx" ON "foreign_currency_carrying_layers"("parent_layer_id");
CREATE UNIQUE INDEX "foreign_currency_movements_source_key" ON "foreign_currency_movements"("source_type", "source_id", "source_line_key", "movement_type");
CREATE INDEX "foreign_currency_movements_source_layer_idx" ON "foreign_currency_movements"("source_layer_id");
CREATE INDEX "foreign_currency_movements_target_layer_idx" ON "foreign_currency_movements"("target_layer_id");
CREATE INDEX "foreign_currency_movements_pool_date_idx" ON "foreign_currency_movements"("historical_pool_date");
CREATE INDEX "foreign_currency_movements_journal_idx" ON "foreign_currency_movements"("journal_transaction_id");

ALTER TABLE "foreign_currency_carrying_layers" ADD CONSTRAINT "foreign_currency_carrying_layers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foreign_currency_carrying_layers" ADD CONSTRAINT "foreign_currency_carrying_layers_parent_layer_id_fkey" FOREIGN KEY ("parent_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_source_layer_id_fkey" FOREIGN KEY ("source_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_target_layer_id_fkey" FOREIGN KEY ("target_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "foreign_currency_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
