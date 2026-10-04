ALTER TYPE "WithdrawalSourceType" ADD VALUE IF NOT EXISTS 'customer';

ALTER TABLE "personal_withdrawals"
ADD COLUMN "customer_payment_id" INTEGER;

CREATE UNIQUE INDEX "personal_withdrawals_customer_payment_id_key"
ON "personal_withdrawals"("customer_payment_id");

ALTER TABLE "personal_withdrawals"
ADD CONSTRAINT "personal_withdrawals_customer_payment_id_fkey"
FOREIGN KEY ("customer_payment_id") REFERENCES "payments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
