-- Personal withdrawals: track whether cash came from office or a customer cheque.
ALTER TABLE "personal_withdrawals"
ADD COLUMN IF NOT EXISTS "source_type" "WithdrawalSourceType" NOT NULL DEFAULT 'cash_office';

ALTER TABLE "personal_withdrawals"
ADD COLUMN IF NOT EXISTS "cheque_payment_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'personal_withdrawals_cheque_payment_id_fkey'
  ) THEN
    ALTER TABLE "personal_withdrawals"
    ADD CONSTRAINT "personal_withdrawals_cheque_payment_id_fkey"
    FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
