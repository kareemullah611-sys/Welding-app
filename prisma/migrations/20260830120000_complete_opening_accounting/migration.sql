CREATE TYPE "OpeningPartyBalanceSide" AS ENUM ('payable', 'receivable');
CREATE TYPE "OpeningHajiBalanceSide" AS ENUM ('payable', 'receivable');
CREATE TYPE "OpeningEquityType" AS ENUM ('manager_capital', 'retained_earnings', 'other');

ALTER TABLE "opening_cashes"
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

ALTER TABLE "opening_haji_balances"
  ADD COLUMN "balance_side" "OpeningHajiBalanceSide" NOT NULL DEFAULT 'payable',
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

ALTER TABLE "opening_customer_balances"
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

ALTER TABLE "opening_bank_balances"
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

ALTER TABLE "opening_cheques"
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

ALTER TABLE "opening_liabilities"
  ADD COLUMN "balance_side" "OpeningPartyBalanceSide" NOT NULL DEFAULT 'payable',
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

UPDATE "opening_liabilities"
SET "balance_side" = 'receivable'
WHERE "liability_type" = 'intermediary';

ALTER TABLE "opening_city_liabilities"
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_rate_to_pkr" DECIMAL(18,8),
  ADD COLUMN "fx_rate_date" DATE,
  ADD COLUMN "fx_rate_source" VARCHAR(120),
  ADD COLUMN "fx_rate_metadata" JSONB;

UPDATE "opening_cashes" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_haji_balances" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_customer_balances" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_bank_balances" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_cheques" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_liabilities" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

UPDATE "opening_city_liabilities" AS opening
SET "carrying_amount_pkr" = opening."amount", "fx_rate_to_pkr" = 1
FROM "currencies" AS currency
WHERE opening."currency_id" = currency."id" AND currency."code" = 'PKR';

CREATE TABLE "opening_inventory_valuations" (
  "id" SERIAL NOT NULL,
  "lot_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "quantity" DECIMAL(15,4) NOT NULL,
  "unit_cost_pkr" DECIMAL(18,6) NOT NULL,
  "total_value_pkr" DECIMAL(15,2) NOT NULL,
  "original_currency_id" INTEGER,
  "original_amount" DECIMAL(15,4),
  "fx_rate_to_pkr" DECIMAL(18,8),
  "fx_rate_date" DATE,
  "fx_rate_source" VARCHAR(120),
  "fx_rate_metadata" JSONB,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "journal_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_inventory_valuations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opening_super_admin_account_balances" (
  "id" SERIAL NOT NULL,
  "account_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "carrying_amount_pkr" DECIMAL(15,2) NOT NULL,
  "fx_rate_to_pkr" DECIMAL(18,8),
  "fx_rate_date" DATE,
  "fx_rate_source" VARCHAR(120),
  "fx_rate_metadata" JSONB,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "journal_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_super_admin_account_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opening_equity_allocations" (
  "id" SERIAL NOT NULL,
  "equity_type" "OpeningEquityType" NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "amount_pkr" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "journal_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_equity_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_opening_inventory_lot_product" ON "opening_inventory_valuations"("lot_id", "product_id");
CREATE INDEX "opening_inventory_valuations_opening_date_idx" ON "opening_inventory_valuations"("opening_date");
CREATE UNIQUE INDEX "unique_opening_super_admin_account" ON "opening_super_admin_account_balances"("account_id");
CREATE INDEX "opening_super_admin_account_balances_opening_date_idx" ON "opening_super_admin_account_balances"("opening_date");
CREATE UNIQUE INDEX "unique_opening_equity_type_label" ON "opening_equity_allocations"("equity_type", "label");
CREATE INDEX "opening_equity_allocations_opening_date_idx" ON "opening_equity_allocations"("opening_date");

ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_original_currency_id_fkey" FOREIGN KEY ("original_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_equity_allocations" ADD CONSTRAINT "opening_equity_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
