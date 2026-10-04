CREATE TYPE "OpeningCityPackageStatus" AS ENUM ('draft', 'submitted', 'returned', 'approved');

CREATE TABLE "opening_city_packages" (
    "id" SERIAL NOT NULL,
    "cutover_id" INTEGER NOT NULL,
    "city_id" INTEGER NOT NULL,
    "status" "OpeningCityPackageStatus" NOT NULL DEFAULT 'draft',
    "return_reason" TEXT,
    "submitted_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "returned_by" INTEGER,
    "returned_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opening_city_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opening_city_due_balances" (
    "id" SERIAL NOT NULL,
    "package_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "city_amount" DECIMAL(20,6),
    "city_carrying_pkr" DECIMAL(15,2),
    "central_amount" DECIMAL(20,6),
    "central_carrying_pkr" DECIMAL(15,2),
    "fx_rate_to_pkr" DECIMAL(18,8),
    "fx_rate_date" DATE,
    "fx_rate_source" VARCHAR(100),
    "fx_rate_metadata" JSONB,
    "city_recorded_by" INTEGER,
    "city_recorded_at" TIMESTAMP(3),
    "central_recorded_by" INTEGER,
    "central_recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opening_city_due_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opening_city_packages_cutover_id_city_id_key" ON "opening_city_packages"("cutover_id", "city_id");
CREATE INDEX "opening_city_packages_status_idx" ON "opening_city_packages"("status");
CREATE UNIQUE INDEX "opening_city_due_balances_package_id_currency_id_key" ON "opening_city_due_balances"("package_id", "currency_id");
CREATE INDEX "opening_city_due_balances_currency_id_idx" ON "opening_city_due_balances"("currency_id");

ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_cutover_id_fkey" FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "opening_city_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
