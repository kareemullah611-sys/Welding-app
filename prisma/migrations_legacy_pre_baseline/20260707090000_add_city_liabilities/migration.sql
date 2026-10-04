ALTER TYPE "ChequeStatus" ADD VALUE IF NOT EXISTS 'used_for_liability';

CREATE TYPE "CityLiabilityEntryType" AS ENUM ('charge', 'payment');
CREATE TYPE "CityLiabilityPaymentSource" AS ENUM ('cash_office', 'cheque', 'bank_account');

CREATE TABLE "city_liability_accounts" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "phone" VARCHAR(50),
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "city_liability_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "city_liability_entries" (
  "id" SERIAL NOT NULL,
  "account_id" INTEGER NOT NULL,
  "city_id" INTEGER NOT NULL,
  "lot_id" INTEGER,
  "currency_id" INTEGER NOT NULL,
  "entry_date" DATE NOT NULL,
  "entry_type" "CityLiabilityEntryType" NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "detail" VARCHAR(500) NOT NULL,
  "note" TEXT,
  "payment_source" "CityLiabilityPaymentSource",
  "bank_account_id" INTEGER,
  "cheque_payment_id" INTEGER,
  "reference_no" VARCHAR(50),
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "city_liability_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opening_city_liabilities" (
  "id" SERIAL NOT NULL,
  "account_id" INTEGER NOT NULL,
  "city_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_city_liabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_city_liability_account_name" ON "city_liability_accounts"("city_id", "name");
CREATE INDEX "city_liability_accounts_city_id_idx" ON "city_liability_accounts"("city_id");
CREATE INDEX "city_liability_accounts_is_active_idx" ON "city_liability_accounts"("is_active");

CREATE INDEX "city_liability_entries_account_id_idx" ON "city_liability_entries"("account_id");
CREATE INDEX "city_liability_entries_city_id_idx" ON "city_liability_entries"("city_id");
CREATE INDEX "city_liability_entries_lot_id_idx" ON "city_liability_entries"("lot_id");
CREATE INDEX "city_liability_entries_entry_date_idx" ON "city_liability_entries"("entry_date");
CREATE INDEX "city_liability_entries_entry_type_idx" ON "city_liability_entries"("entry_type");

CREATE UNIQUE INDEX "unique_opening_city_liability_account_currency" ON "opening_city_liabilities"("account_id", "currency_id");
CREATE INDEX "opening_city_liabilities_city_id_idx" ON "opening_city_liabilities"("city_id");
CREATE INDEX "opening_city_liabilities_opening_date_idx" ON "opening_city_liabilities"("opening_date");

ALTER TABLE "city_liability_accounts"
  ADD CONSTRAINT "city_liability_accounts_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_liability_accounts"
  ADD CONSTRAINT "city_liability_accounts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "city_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_cheque_payment_id_fkey"
  FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_city_liabilities"
  ADD CONSTRAINT "opening_city_liabilities_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "city_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_liabilities"
  ADD CONSTRAINT "opening_city_liabilities_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_liabilities"
  ADD CONSTRAINT "opening_city_liabilities_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_liabilities"
  ADD CONSTRAINT "opening_city_liabilities_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "city_liability_entries"
  ADD CONSTRAINT "city_liability_entries_payment_source_check"
  CHECK (
    ("entry_type" = 'charge' AND "payment_source" IS NULL AND "bank_account_id" IS NULL AND "cheque_payment_id" IS NULL)
    OR
    ("entry_type" = 'payment' AND "payment_source" IS NOT NULL)
  );
