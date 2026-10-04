-- Add super admin bank account to supplier payments
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "super_admin_bank_account_id" INTEGER;

CREATE INDEX IF NOT EXISTS "supplier_payments_super_admin_bank_account_id_idx"
  ON "supplier_payments"("super_admin_bank_account_id");

DO $$ BEGIN
  ALTER TABLE "supplier_payments"
    ADD CONSTRAINT "supplier_payments_super_admin_bank_account_id_fkey"
    FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
