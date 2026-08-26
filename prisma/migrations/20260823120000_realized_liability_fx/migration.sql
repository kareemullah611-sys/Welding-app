ALTER TABLE "supplier_payments"
  ADD COLUMN "carrying_rate_pkr" DECIMAL(12,6),
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "realized_fx_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_pool_date" DATE,
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "shipping_line_payments"
  ADD COLUMN "carrying_rate_pkr" DECIMAL(12,6),
  ADD COLUMN "carrying_amount_pkr" DECIMAL(15,2),
  ADD COLUMN "realized_fx_pkr" DECIMAL(15,2),
  ADD COLUMN "fx_pool_date" DATE,
  ADD COLUMN "journal_version" INTEGER NOT NULL DEFAULT 1;
