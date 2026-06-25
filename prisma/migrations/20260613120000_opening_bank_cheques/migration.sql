-- CreateTable
CREATE TABLE "opening_bank_balances" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "bank_account_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_bank_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_cheques" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "cheque_number" VARCHAR(50) NOT NULL,
  "cheque_bank" VARCHAR(100),
  "cheque_due_date" DATE,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_cheques_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_opening_bank_account_currency" ON "opening_bank_balances"("bank_account_id", "currency_id");
CREATE INDEX "opening_bank_balances_city_id_idx" ON "opening_bank_balances"("city_id");
CREATE INDEX "opening_cheques_city_id_idx" ON "opening_cheques"("city_id");

-- AddForeignKey
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_bank_balances"
  ADD CONSTRAINT "opening_bank_balances_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_cheques"
  ADD CONSTRAINT "opening_cheques_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_cheques"
  ADD CONSTRAINT "opening_cheques_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_cheques"
  ADD CONSTRAINT "opening_cheques_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
