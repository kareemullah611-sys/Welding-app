CREATE TABLE "opening_haji_balances" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_haji_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_opening_haji_city_currency" ON "opening_haji_balances"("city_id", "currency_id");
CREATE INDEX "opening_haji_balances_city_id_idx" ON "opening_haji_balances"("city_id");
CREATE INDEX "opening_haji_balances_opening_date_idx" ON "opening_haji_balances"("opening_date");

ALTER TABLE "opening_haji_balances"
  ADD CONSTRAINT "opening_haji_balances_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_haji_balances"
  ADD CONSTRAINT "opening_haji_balances_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_haji_balances"
  ADD CONSTRAINT "opening_haji_balances_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
