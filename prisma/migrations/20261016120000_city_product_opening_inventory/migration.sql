ALTER TABLE "opening_inventory_valuations"
  ADD COLUMN "city_id" INTEGER,
  ALTER COLUMN "lot_id" DROP NOT NULL;

ALTER TABLE "sale_items"
  ADD COLUMN "opening_inventory_valuation_id" INTEGER,
  ALTER COLUMN "lot_id" DROP NOT NULL;

ALTER TABLE "sales"
  ALTER COLUMN "lot_id" DROP NOT NULL;

ALTER TABLE "godown_transfers"
  ADD COLUMN "opening_inventory_valuation_id" INTEGER,
  ALTER COLUMN "lot_id" DROP NOT NULL;

ALTER TABLE "city_transfers"
  ADD COLUMN "opening_inventory_valuation_id" INTEGER,
  ALTER COLUMN "lot_id" DROP NOT NULL;

CREATE UNIQUE INDEX "opening_inventory_valuations_city_id_product_id_key"
  ON "opening_inventory_valuations"("city_id", "product_id");
CREATE INDEX "opening_inventory_valuations_city_id_idx"
  ON "opening_inventory_valuations"("city_id");
CREATE INDEX "sale_items_opening_inventory_valuation_id_idx"
  ON "sale_items"("opening_inventory_valuation_id");
CREATE INDEX "godown_transfers_opening_inventory_valuation_id_idx"
  ON "godown_transfers"("opening_inventory_valuation_id");
CREATE INDEX "city_transfers_opening_inventory_valuation_id_idx"
  ON "city_transfers"("opening_inventory_valuation_id");

ALTER TABLE "opening_inventory_valuations"
  ADD CONSTRAINT "opening_inventory_valuations_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_opening_inventory_valuation_id_fkey"
  FOREIGN KEY ("opening_inventory_valuation_id") REFERENCES "opening_inventory_valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "godown_transfers"
  ADD CONSTRAINT "godown_transfers_opening_inventory_valuation_id_fkey"
  FOREIGN KEY ("opening_inventory_valuation_id") REFERENCES "opening_inventory_valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "city_transfers"
  ADD CONSTRAINT "city_transfers_opening_inventory_valuation_id_fkey"
  FOREIGN KEY ("opening_inventory_valuation_id") REFERENCES "opening_inventory_valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_inventory_valuations"
  ADD CONSTRAINT "opening_inventory_valuation_source_check"
  CHECK (("city_id" IS NOT NULL AND "lot_id" IS NULL) OR ("city_id" IS NULL AND "lot_id" IS NOT NULL));

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_item_inventory_source_check"
  CHECK (("lot_id" IS NOT NULL AND "opening_inventory_valuation_id" IS NULL) OR ("lot_id" IS NULL AND "opening_inventory_valuation_id" IS NOT NULL));

ALTER TABLE "godown_transfers"
  ADD CONSTRAINT "godown_transfer_inventory_source_check"
  CHECK (("lot_id" IS NOT NULL AND "opening_inventory_valuation_id" IS NULL) OR ("lot_id" IS NULL AND "opening_inventory_valuation_id" IS NOT NULL));

ALTER TABLE "city_transfers"
  ADD CONSTRAINT "city_transfer_inventory_source_check"
  CHECK (("lot_id" IS NOT NULL AND "opening_inventory_valuation_id" IS NULL) OR ("lot_id" IS NULL AND "opening_inventory_valuation_id" IS NOT NULL));
