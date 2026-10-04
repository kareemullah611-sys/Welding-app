-- Existing installations predate the fresh-database baseline. Bring them to
-- the current schema without dropping legacy evidence or guessing ownership.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OpeningCityPackageStatus') THEN
    CREATE TYPE "OpeningCityPackageStatus" AS ENUM ('draft', 'submitted', 'returned', 'approved');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "opening_cutover_entries" (
  "id" SERIAL NOT NULL,
  "cutover_id" INTEGER NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "opening_cutover_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "opening_cutover_entries_entity_type_entity_id_key"
  ON "opening_cutover_entries"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "opening_cutover_entries_cutover_id_idx"
  ON "opening_cutover_entries"("cutover_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_cutover_entries_cutover_id_fkey') THEN
    ALTER TABLE "opening_cutover_entries"
      ADD CONSTRAINT "opening_cutover_entries_cutover_id_fkey"
      FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "opening_city_packages" (
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

CREATE TABLE IF NOT EXISTS "opening_city_due_balances" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "opening_city_packages_cutover_id_city_id_key"
  ON "opening_city_packages"("cutover_id", "city_id");
CREATE INDEX IF NOT EXISTS "opening_city_packages_status_idx"
  ON "opening_city_packages"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "opening_city_due_balances_package_id_currency_id_key"
  ON "opening_city_due_balances"("package_id", "currency_id");
CREATE INDEX IF NOT EXISTS "opening_city_due_balances_currency_id_idx"
  ON "opening_city_due_balances"("currency_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_city_packages_cutover_id_fkey') THEN
    ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_cutover_id_fkey"
      FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_city_packages_city_id_fkey') THEN
    ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_city_id_fkey"
      FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_city_due_balances_package_id_fkey') THEN
    ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_package_id_fkey"
      FOREIGN KEY ("package_id") REFERENCES "opening_city_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_city_due_balances_currency_id_fkey') THEN
    ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_currency_id_fkey"
      FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "opening_cutovers" ADD COLUMN IF NOT EXISTS "previous_snapshot_hash" CHAR(64);
ALTER TABLE "opening_cutovers" ADD COLUMN IF NOT EXISTS "final_snapshot_hash" CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "opening_cutovers_final_snapshot_hash_key"
  ON "opening_cutovers"("final_snapshot_hash");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'opening_cheques' AND column_name = 'customer_id'
  ) THEN
    IF EXISTS (SELECT 1 FROM "opening_cheques") THEN
      RAISE EXCEPTION 'OPENING_CHEQUE_CUSTOMER_REMEDIATION_REQUIRED';
    END IF;
    ALTER TABLE "opening_cheques" ADD COLUMN "customer_id" INTEGER;
    ALTER TABLE "opening_cheques" ALTER COLUMN "customer_id" SET NOT NULL;
  END IF;
END $$;

ALTER TABLE "opening_cheques" ADD COLUMN IF NOT EXISTS "cheque_status" "ChequeStatus" NOT NULL DEFAULT 'in_hand';
ALTER TABLE "opening_cheques" ADD COLUMN IF NOT EXISTS "bank_deposit_id" INTEGER;
ALTER TABLE "opening_cheques" ADD COLUMN IF NOT EXISTS "bounced_at" TIMESTAMP(3);
ALTER TABLE "opening_cheques" ADD COLUMN IF NOT EXISTS "bounced_by" INTEGER;
CREATE INDEX IF NOT EXISTS "opening_cheques_customer_id_idx" ON "opening_cheques"("customer_id");
CREATE INDEX IF NOT EXISTS "opening_cheques_bank_deposit_id_idx" ON "opening_cheques"("bank_deposit_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_cheques_customer_id_fkey') THEN
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_cheques_bank_deposit_id_fkey') THEN
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_bank_deposit_id_fkey"
      FOREIGN KEY ("bank_deposit_id") REFERENCES "bank_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "investment_participant_settlements" ADD COLUMN IF NOT EXISTS "fx_snapshot_id" INTEGER;

DO $$
DECLARE
  has_conflict BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investment_participant_settlement_payments'
      AND column_name = 'fx_snapshot_id'
  ) THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM "investment_participant_settlement_payments"
        WHERE "fx_snapshot_id" IS NOT NULL
        GROUP BY "settlement_id"
        HAVING COUNT(DISTINCT "fx_snapshot_id") > 1
      )'
      INTO has_conflict;
    IF has_conflict THEN
      RAISE EXCEPTION 'SETTLEMENT_FX_SNAPSHOT_CONFLICT';
    END IF;

    EXECUTE '
      UPDATE "investment_participant_settlements" AS settlement
      SET "fx_snapshot_id" = source."fx_snapshot_id"
      FROM (
        SELECT "settlement_id", MIN("fx_snapshot_id") AS "fx_snapshot_id"
        FROM "investment_participant_settlement_payments"
        WHERE "fx_snapshot_id" IS NOT NULL
        GROUP BY "settlement_id"
      ) AS source
      WHERE settlement."id" = source."settlement_id"
        AND settlement."fx_snapshot_id" IS NULL';
  END IF;
END $$;

-- Legacy columns, indexes, constraints, and tables are intentionally retained.
-- They are accounting evidence and may be removed only by a separately audited migration.
