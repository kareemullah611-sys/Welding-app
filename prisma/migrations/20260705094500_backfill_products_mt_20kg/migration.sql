UPDATE "products"
SET
  "unit_of_measure" = 'MT',
  "default_weight_per_carton_kg" = 20,
  "pieces_per_carton" = NULL
WHERE "default_weight_per_carton_kg" IS NULL;
