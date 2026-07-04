DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WithdrawalSourceType'
      AND e.enumlabel = 'bank_account'
  ) THEN
    ALTER TYPE "WithdrawalSourceType" ADD VALUE 'bank_account';
  END IF;
END $$;

ALTER TABLE "personal_withdrawals"
  ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER;

CREATE INDEX IF NOT EXISTS "personal_withdrawals_bank_account_id_idx"
  ON "personal_withdrawals"("bank_account_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'personal_withdrawals_bank_account_id_fkey'
  ) THEN
    ALTER TABLE "personal_withdrawals"
      ADD CONSTRAINT "personal_withdrawals_bank_account_id_fkey"
      FOREIGN KEY ("bank_account_id")
      REFERENCES "bank_accounts"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
