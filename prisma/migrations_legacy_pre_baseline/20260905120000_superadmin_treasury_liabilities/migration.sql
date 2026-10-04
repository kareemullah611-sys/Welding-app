CREATE TYPE "SuperAdminLiabilityPartyType" AS ENUM ('lender', 'creditor');
CREATE TYPE "SuperAdminLiabilityEntryType" AS ENUM ('loan_received', 'liability_incurred', 'payment', 'reversal');
CREATE TYPE "SuperAdminLiabilitySourceType" AS ENUM ('super_admin_bank', 'super_admin_cash', 'intermediary', 'city_bank', 'city_cash');
CREATE TYPE "SuperAdminTransferType" AS ENUM ('same_currency', 'exchange');

ALTER TABLE "intermediary_deposits"
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" INTEGER;

ALTER TABLE "agent_payments"
  ADD COLUMN "super_admin_bank_account_id" INTEGER,
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" INTEGER;

ALTER TABLE "supplier_payments"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" INTEGER;

ALTER TABLE "shipping_line_payments"
  ADD COLUMN "super_admin_bank_account_id" INTEGER,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" INTEGER;

ALTER TABLE "haji_cash_receipts"
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by" INTEGER;

CREATE TABLE "super_admin_liability_accounts" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "party_type" "SuperAdminLiabilityPartyType" NOT NULL,
  "phone" VARCHAR(50),
  "address" TEXT,
  "notes" TEXT,
  "control_account_id" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "super_admin_liability_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "super_admin_liability_entries" (
  "id" SERIAL NOT NULL,
  "account_id" INTEGER NOT NULL,
  "entry_type" "SuperAdminLiabilityEntryType" NOT NULL,
  "entry_date" DATE NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "liability_effect" DECIMAL(15,2) NOT NULL,
  "exchange_rate_to_pkr" DECIMAL(18,8) NOT NULL,
  "pkr_amount" DECIMAL(15,2) NOT NULL,
  "pkr_liability_effect" DECIMAL(15,2) NOT NULL,
  "carrying_rate_pkr" DECIMAL(18,8),
  "carrying_amount_pkr" DECIMAL(15,2),
  "realized_fx_pkr" DECIMAL(15,2),
  "rate_source" VARCHAR(120) NOT NULL,
  "source_type" "SuperAdminLiabilitySourceType",
  "super_admin_bank_account_id" INTEGER,
  "super_admin_cash_account_id" INTEGER,
  "intermediary_id" INTEGER,
  "bank_account_id" INTEGER,
  "city_id" INTEGER,
  "counter_account_id" INTEGER,
  "reversed_entry_id" INTEGER,
  "reference" VARCHAR(200),
  "remarks" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_by" INTEGER,
  "reversed_at" TIMESTAMP(3),
  CONSTRAINT "super_admin_liability_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "super_admin_account_transfers" (
  "id" SERIAL NOT NULL,
  "transfer_date" DATE NOT NULL,
  "transfer_type" "SuperAdminTransferType" NOT NULL,
  "source_account_id" INTEGER NOT NULL,
  "destination_account_id" INTEGER NOT NULL,
  "from_currency_id" INTEGER NOT NULL,
  "to_currency_id" INTEGER NOT NULL,
  "from_amount" DECIMAL(15,2) NOT NULL,
  "to_amount" DECIMAL(15,2) NOT NULL,
  "exchange_rate" DECIMAL(18,8),
  "rate_source" VARCHAR(120),
  "reference" VARCHAR(200),
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_at" TIMESTAMP(3),
  "reversed_by" INTEGER,
  CONSTRAINT "super_admin_account_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_liability_accounts_control_account_id_key" ON "super_admin_liability_accounts"("control_account_id");
CREATE UNIQUE INDEX "super_admin_liability_accounts_name_type_key" ON "super_admin_liability_accounts"("name", "party_type");
CREATE INDEX "super_admin_liability_accounts_party_type_is_active_idx" ON "super_admin_liability_accounts"("party_type", "is_active");
CREATE UNIQUE INDEX "super_admin_liability_entries_reversed_entry_id_key" ON "super_admin_liability_entries"("reversed_entry_id");
CREATE INDEX "super_admin_liability_entries_account_id_currency_id_entry_date_idx" ON "super_admin_liability_entries"("account_id", "currency_id", "entry_date");
CREATE INDEX "super_admin_liability_entries_entry_type_idx" ON "super_admin_liability_entries"("entry_type");
CREATE INDEX "super_admin_liability_entries_source_type_idx" ON "super_admin_liability_entries"("source_type");
CREATE INDEX "super_admin_account_transfers_transfer_date_idx" ON "super_admin_account_transfers"("transfer_date");
CREATE INDEX "super_admin_account_transfers_source_account_id_idx" ON "super_admin_account_transfers"("source_account_id");
CREATE INDEX "super_admin_account_transfers_destination_account_id_idx" ON "super_admin_account_transfers"("destination_account_id");
CREATE INDEX "intermediary_deposits_deleted_at_idx" ON "intermediary_deposits"("deleted_at");
CREATE INDEX "agent_payments_super_admin_bank_account_id_idx" ON "agent_payments"("super_admin_bank_account_id");
CREATE INDEX "agent_payments_deleted_at_idx" ON "agent_payments"("deleted_at");
CREATE INDEX "supplier_payments_deleted_at_idx" ON "supplier_payments"("deleted_at");
CREATE INDEX "shipping_line_payments_super_admin_bank_account_id_idx" ON "shipping_line_payments"("super_admin_bank_account_id");
CREATE INDEX "shipping_line_payments_deleted_at_idx" ON "shipping_line_payments"("deleted_at");
CREATE INDEX "haji_cash_receipts_reversed_at_idx" ON "haji_cash_receipts"("reversed_at");

ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_accounts" ADD CONSTRAINT "super_admin_liability_accounts_control_account_id_fkey" FOREIGN KEY ("control_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_accounts" ADD CONSTRAINT "super_admin_liability_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "super_admin_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_counter_account_id_fkey" FOREIGN KEY ("counter_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_reversed_entry_id_fkey" FOREIGN KEY ("reversed_entry_id") REFERENCES "super_admin_liability_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
