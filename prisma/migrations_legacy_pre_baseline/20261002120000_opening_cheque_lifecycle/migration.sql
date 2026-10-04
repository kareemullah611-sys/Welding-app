ALTER TABLE "opening_cheques"
ADD COLUMN "customer_id" INTEGER NOT NULL,
ADD COLUMN "cheque_status" "ChequeStatus" NOT NULL DEFAULT 'in_hand',
ADD COLUMN "bank_deposit_id" INTEGER,
ADD COLUMN "bounced_at" TIMESTAMP(3),
ADD COLUMN "bounced_by" INTEGER;

CREATE INDEX "opening_cheques_customer_id_idx" ON "opening_cheques"("customer_id");
CREATE INDEX "opening_cheques_bank_deposit_id_idx" ON "opening_cheques"("bank_deposit_id");
ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_bank_deposit_id_fkey" FOREIGN KEY ("bank_deposit_id") REFERENCES "bank_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
