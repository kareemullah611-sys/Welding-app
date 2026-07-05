ALTER TABLE "products"
  ADD COLUMN "packets_per_carton" INTEGER;

ALTER TABLE "products"
  ADD CONSTRAINT "products_packets_per_carton_check"
  CHECK (
    "packets_per_carton" IS NULL
    OR "packets_per_carton" > 0
  );
