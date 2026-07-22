ALTER TABLE "sale_items"
  ADD COLUMN "lot_id" INTEGER;

UPDATE "sale_items" si
SET "lot_id" = s."lot_id"
FROM "sales" s
WHERE si."sale_id" = s."id"
  AND si."lot_id" IS NULL;

ALTER TABLE "sale_items"
  ALTER COLUMN "lot_id" SET NOT NULL;

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "sale_items_lot_id_idx" ON "sale_items"("lot_id");
