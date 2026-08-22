ALTER TABLE "bank_deposits"
  ALTER COLUMN "bank_account_id" DROP NOT NULL,
  ADD COLUMN "transfer_type" VARCHAR(30) NOT NULL DEFAULT 'cheque_to_bank',
  ADD COLUMN "transfer_pair_id" VARCHAR(50);

UPDATE "bank_deposits" SET "transfer_type" = CASE
  WHEN "notes" LIKE '%[B2B-OUT]%' OR "notes" LIKE '%[B2B-IN]%' THEN 'bank_to_bank'
  WHEN "cash_amount" < 0 AND EXISTS (SELECT 1 FROM "payments" p WHERE p."bank_deposit_id" = "bank_deposits"."id") THEN 'cheque_to_cash'
  WHEN "cash_amount" < 0 THEN 'bank_to_cash'
  ELSE 'cheque_to_bank'
END;

CREATE INDEX "bank_deposits_transfer_pair_id_idx" ON "bank_deposits"("transfer_pair_id");
