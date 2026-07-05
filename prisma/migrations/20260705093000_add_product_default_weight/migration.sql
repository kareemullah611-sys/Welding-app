ALTER TABLE "products"
  ADD COLUMN "default_weight_per_carton_kg" DECIMAL(10,3);

ALTER TABLE "products"
  ADD CONSTRAINT "products_default_weight_check"
  CHECK (
    "default_weight_per_carton_kg" IS NULL
    OR "default_weight_per_carton_kg" > 0
  );
