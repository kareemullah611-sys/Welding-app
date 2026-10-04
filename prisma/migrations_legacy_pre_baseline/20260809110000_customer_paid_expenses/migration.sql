ALTER TYPE "ExpensePaidFrom" ADD VALUE IF NOT EXISTS 'customer';

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "customer_payment_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "expenses_customer_payment_id_key"
  ON "expenses" ("customer_payment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_customer_payment_id_fkey'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_customer_payment_id_fkey"
      FOREIGN KEY ("customer_payment_id") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
