-- CreateTable
CREATE TABLE "opening_cashes" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_cashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_customer_balances" (
  "id" SERIAL NOT NULL,
  "customer_id" INTEGER NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_customer_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_stocks" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "godown_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "qty" DECIMAL(12,2) NOT NULL,
  "opening_date" DATE NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "opening_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_opening_cash_city_currency" ON "opening_cashes"("city_id", "currency_id");
CREATE INDEX "opening_cashes_city_id_idx" ON "opening_cashes"("city_id");
CREATE INDEX "opening_cashes_opening_date_idx" ON "opening_cashes"("opening_date");

-- CreateIndex
CREATE UNIQUE INDEX "unique_opening_customer_currency" ON "opening_customer_balances"("customer_id", "currency_id");
CREATE INDEX "opening_customer_balances_customer_id_idx" ON "opening_customer_balances"("customer_id");
CREATE INDEX "opening_customer_balances_opening_date_idx" ON "opening_customer_balances"("opening_date");

-- CreateIndex
CREATE UNIQUE INDEX "unique_opening_stock_godown_product" ON "opening_stocks"("godown_id", "product_id");
CREATE INDEX "opening_stocks_city_id_idx" ON "opening_stocks"("city_id");
CREATE INDEX "opening_stocks_opening_date_idx" ON "opening_stocks"("opening_date");

-- AddForeignKey
ALTER TABLE "opening_cashes"
  ADD CONSTRAINT "opening_cashes_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_cashes"
  ADD CONSTRAINT "opening_cashes_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_cashes"
  ADD CONSTRAINT "opening_cashes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_customer_balances"
  ADD CONSTRAINT "opening_customer_balances_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_customer_balances"
  ADD CONSTRAINT "opening_customer_balances_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_customer_balances"
  ADD CONSTRAINT "opening_customer_balances_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_godown_id_fkey"
  FOREIGN KEY ("godown_id") REFERENCES "godowns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_stocks"
  ADD CONSTRAINT "opening_stocks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
