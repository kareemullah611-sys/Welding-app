-- AlterTable: make lot_id optional in haji_transfers
ALTER TABLE "haji_transfers" ALTER COLUMN "lot_id" DROP NOT NULL;
