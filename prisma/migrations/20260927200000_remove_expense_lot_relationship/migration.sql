-- Expenses are operational city transactions and must not carry lot attribution.
UPDATE "journal_entries"
SET "lot_id" = NULL
WHERE "entity_type" = 'expense';

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_lot_id_fkey";
DROP INDEX IF EXISTS "expenses_lot_id_idx";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "lot_id";
