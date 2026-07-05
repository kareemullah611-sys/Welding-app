CREATE TYPE "ProductUnitOfMeasure" AS ENUM ('MT', 'PCS');

ALTER TABLE "products"
  ADD COLUMN "unit_of_measure" "ProductUnitOfMeasure" NOT NULL DEFAULT 'MT',
  ADD COLUMN "pieces_per_carton" INTEGER;

ALTER TABLE "products"
  ADD CONSTRAINT "products_pcs_carton_check"
  CHECK (
    ("unit_of_measure" = 'MT' AND "pieces_per_carton" IS NULL)
    OR
    ("unit_of_measure" = 'PCS' AND "pieces_per_carton" IS NOT NULL AND "pieces_per_carton" > 0)
  );

ALTER TABLE "sale_items"
  ADD COLUMN "carton_qty" DECIMAL(12,2),
  ADD COLUMN "rate_per_piece_local" DECIMAL(12,4),
  ADD COLUMN "rate_per_piece_usd" DECIMAL(12,4),
  ADD COLUMN "amount_usd" DECIMAL(15,2);
