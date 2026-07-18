UPDATE "haji_transfers"
SET "settlement_destination" = 'standard'
WHERE "settlement_destination" = 'party_account';

ALTER TABLE "haji_transfers"
  DROP CONSTRAINT IF EXISTS "haji_transfers_party_destination_check";

DROP INDEX IF EXISTS "haji_transfers_destination_party_type_idx";
DROP INDEX IF EXISTS "haji_transfers_destination_supplier_id_idx";
DROP INDEX IF EXISTS "haji_transfers_destination_shipping_line_id_idx";
DROP INDEX IF EXISTS "haji_transfers_destination_agent_id_idx";
DROP INDEX IF EXISTS "haji_transfers_destination_intermediary_id_idx";

ALTER TABLE "haji_transfers"
  DROP CONSTRAINT IF EXISTS "haji_transfers_destination_supplier_id_fkey",
  DROP CONSTRAINT IF EXISTS "haji_transfers_destination_shipping_line_id_fkey",
  DROP CONSTRAINT IF EXISTS "haji_transfers_destination_agent_id_fkey",
  DROP CONSTRAINT IF EXISTS "haji_transfers_destination_intermediary_id_fkey";

ALTER TABLE "haji_transfers"
  DROP COLUMN IF EXISTS "destination_party_type",
  DROP COLUMN IF EXISTS "destination_supplier_id",
  DROP COLUMN IF EXISTS "destination_shipping_line_id",
  DROP COLUMN IF EXISTS "destination_agent_id",
  DROP COLUMN IF EXISTS "destination_intermediary_id";
