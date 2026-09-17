CREATE TYPE "LotCostAllocationBasis" AS ENUM ('purchase_value', 'weight', 'cartons', 'specific_product');

ALTER TABLE "lot_costs"
ADD COLUMN "allocation_basis" "LotCostAllocationBasis" NOT NULL DEFAULT 'cartons',
ADD COLUMN "allocated_product_id" INTEGER;

CREATE INDEX "lot_costs_allocated_product_id_idx" ON "lot_costs"("allocated_product_id");

ALTER TABLE "lot_costs"
ADD CONSTRAINT "lot_costs_allocated_product_id_fkey"
FOREIGN KEY ("allocated_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
