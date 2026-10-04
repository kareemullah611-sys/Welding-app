ALTER TABLE "opening_cashes" DROP CONSTRAINT IF EXISTS "opening_cashes_city_id_fkey";
ALTER TABLE "opening_cashes"
  ADD CONSTRAINT "opening_cashes_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_haji_balances" DROP CONSTRAINT IF EXISTS "opening_haji_balances_city_id_fkey";
ALTER TABLE "opening_haji_balances"
  ADD CONSTRAINT "opening_haji_balances_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_customer_balances" DROP CONSTRAINT IF EXISTS "opening_customer_balances_customer_id_fkey";
ALTER TABLE "opening_customer_balances"
  ADD CONSTRAINT "opening_customer_balances_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_stocks" DROP CONSTRAINT IF EXISTS "opening_stocks_city_id_fkey";
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_stocks" DROP CONSTRAINT IF EXISTS "opening_stocks_godown_id_fkey";
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_godown_id_fkey"
  FOREIGN KEY ("godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_bank_balances" DROP CONSTRAINT IF EXISTS "opening_bank_balances_city_id_fkey";
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_bank_balances" DROP CONSTRAINT IF EXISTS "opening_bank_balances_bank_account_id_fkey";
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_cheques" DROP CONSTRAINT IF EXISTS "opening_cheques_city_id_fkey";
ALTER TABLE "opening_cheques"
  ADD CONSTRAINT "opening_cheques_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_liabilities" DROP CONSTRAINT IF EXISTS "opening_liabilities_supplier_id_fkey";
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_liabilities" DROP CONSTRAINT IF EXISTS "opening_liabilities_shipping_line_id_fkey";
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_shipping_line_id_fkey"
  FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_liabilities" DROP CONSTRAINT IF EXISTS "opening_liabilities_agent_id_fkey";
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_liabilities" DROP CONSTRAINT IF EXISTS "opening_liabilities_intermediary_id_fkey";
ALTER TABLE "opening_liabilities"
  ADD CONSTRAINT "opening_liabilities_intermediary_id_fkey"
  FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
