ALTER TABLE "haji_transfers" ADD COLUMN IF NOT EXISTS "super_admin_bank_account_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'haji_transfers_super_admin_bank_account_id_fkey'
  ) THEN
    ALTER TABLE "haji_transfers"
      ADD CONSTRAINT "haji_transfers_super_admin_bank_account_id_fkey"
      FOREIGN KEY ("super_admin_bank_account_id")
      REFERENCES "super_admin_bank_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "haji_transfers_super_admin_bank_account_id_idx"
  ON "haji_transfers"("super_admin_bank_account_id");
