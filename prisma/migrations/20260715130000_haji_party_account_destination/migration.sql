ALTER TYPE "HajiSettlementDestination" ADD VALUE IF NOT EXISTS 'party_account';

ALTER TABLE "haji_transfers"
  ADD COLUMN IF NOT EXISTS "destination_party_type" "OpeningLiabilityType",
  ADD COLUMN IF NOT EXISTS "destination_supplier_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "destination_shipping_line_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "destination_agent_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "destination_intermediary_id" INTEGER;

ALTER TABLE "haji_transfers"
  ADD CONSTRAINT "haji_transfers_destination_supplier_id_fkey"
  FOREIGN KEY ("destination_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "haji_transfers"
  ADD CONSTRAINT "haji_transfers_destination_shipping_line_id_fkey"
  FOREIGN KEY ("destination_shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "haji_transfers"
  ADD CONSTRAINT "haji_transfers_destination_agent_id_fkey"
  FOREIGN KEY ("destination_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "haji_transfers"
  ADD CONSTRAINT "haji_transfers_destination_intermediary_id_fkey"
  FOREIGN KEY ("destination_intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "haji_transfers_destination_party_type_idx" ON "haji_transfers"("destination_party_type");
CREATE INDEX IF NOT EXISTS "haji_transfers_destination_supplier_id_idx" ON "haji_transfers"("destination_supplier_id");
CREATE INDEX IF NOT EXISTS "haji_transfers_destination_shipping_line_id_idx" ON "haji_transfers"("destination_shipping_line_id");
CREATE INDEX IF NOT EXISTS "haji_transfers_destination_agent_id_idx" ON "haji_transfers"("destination_agent_id");
CREATE INDEX IF NOT EXISTS "haji_transfers_destination_intermediary_id_idx" ON "haji_transfers"("destination_intermediary_id");
