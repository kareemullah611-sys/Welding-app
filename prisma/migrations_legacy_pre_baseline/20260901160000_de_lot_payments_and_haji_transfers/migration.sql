-- Align payments.lot_id with the already-nullable Payment.lotId schema.
-- Customer-paid expense payments now auto-assign a FIFO lot, so no code writes NULL here,
-- but the column is kept nullable (matching the Prisma schema) as a safety net.
ALTER TABLE "payments" ALTER COLUMN "lot_id" DROP NOT NULL;
