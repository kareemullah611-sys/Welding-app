import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("PCS carton products are modeled from product master through purchase and sale flows", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260705090000_add_pcs_carton_products/migration.sql", "utf8");
  const weightMigration = readFileSync("prisma/migrations/20260705093000_add_product_default_weight/migration.sql", "utf8");
  const backfillMigration = readFileSync("prisma/migrations/20260705094500_backfill_products_mt_20kg/migration.sql", "utf8");
  const packetsMigration = readFileSync("prisma/migrations/20260705100000_add_product_packets_per_carton/migration.sql", "utf8");
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const productsRoute = readFileSync("src/app/api/v1/products/route.ts", "utf8");
  const productRoute = readFileSync("src/app/api/v1/products/[id]/route.ts", "utf8");
  const lotsRoute = readFileSync("src/app/api/v1/lots/route.ts", "utf8");
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const lotsPage = readFileSync("src/app/(dashboard)/lots/page.tsx", "utf8");
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const settingsPage = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");

  assert.match(schema, /enum ProductUnitOfMeasure\s*{[^}]*MT[^}]*PCS/s);
  assert.match(schema, /unitOfMeasure\s+ProductUnitOfMeasure\s+@default\(MT\)\s+@map\("unit_of_measure"\)/);
  assert.match(schema, /defaultWeightPerCartonKg\s+Decimal\?\s+@map\("default_weight_per_carton_kg"\)\s+@db\.Decimal\(10, 3\)/);
  assert.match(schema, /packetsPerCarton\s+Int\?\s+@map\("packets_per_carton"\)/);
  assert.match(schema, /piecesPerCarton\s+Int\?\s+@map\("pieces_per_carton"\)/);
  assert.match(schema, /cartonQty\s+Decimal\?\s+@map\("carton_qty"\)/);
  assert.match(schema, /ratePerPieceLocal\s+Decimal\?\s+@map\("rate_per_piece_local"\)/);
  assert.match(schema, /ratePerPieceUsd\s+Decimal\?\s+@map\("rate_per_piece_usd"\)/);
  assert.match(schema, /amountUsd\s+Decimal\?\s+@map\("amount_usd"\)/);

  assert.match(migration, /CREATE TYPE "ProductUnitOfMeasure" AS ENUM \('MT', 'PCS'\)/);
  assert.match(migration, /ADD COLUMN\s+"unit_of_measure" "ProductUnitOfMeasure" NOT NULL DEFAULT 'MT'/);
  assert.match(migration, /ADD COLUMN\s+"pieces_per_carton" INTEGER/);
  assert.match(migration, /products_pcs_carton_check/);
  assert.match(migration, /ADD COLUMN\s+"carton_qty" DECIMAL\(12,2\)/);
  assert.match(migration, /ADD COLUMN\s+"rate_per_piece_local" DECIMAL\(12,4\)/);
  assert.match(weightMigration, /ADD COLUMN "default_weight_per_carton_kg" DECIMAL\(10,3\)/);
  assert.match(weightMigration, /products_default_weight_check/);
  assert.match(backfillMigration, /"unit_of_measure" = 'MT'/);
  assert.match(backfillMigration, /"default_weight_per_carton_kg" = 20/);
  assert.match(backfillMigration, /"pieces_per_carton" = NULL/);
  assert.match(packetsMigration, /ADD COLUMN "packets_per_carton" INTEGER/);
  assert.match(packetsMigration, /products_packets_per_carton_check/);

  assert.match(validations, /unitOfMeasure:\s*z\.enum\(\["MT", "PCS"\]\)/);
  assert.match(validations, /defaultWeightPerCartonKg/);
  assert.match(validations, /packetsPerCarton/);
  assert.match(validations, /piecesPerCarton/);
  assert.match(validations, /qtyPcs:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);
  assert.match(validations, /unitPriceUsdPerPcs:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);
  assert.match(validations, /ratePerPieceLocal:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);
  assert.match(validations, /ratePerPieceUsd:\s*z\.number\(\)\.positive\(\)\.optional\(\)/);

  for (const route of [productsRoute, productRoute]) {
    assert.match(route, /unitOfMeasure/);
    assert.match(route, /defaultWeightPerCartonKg/);
    assert.match(route, /packetsPerCarton/);
    assert.match(route, /piecesPerCarton/);
  }

  assert.match(lotsRoute, /defaultWeightPerCartonKg/);
  assert.match(lotsRoute, /toDisplayStockQty/);
  assert.match(lotsRoute, /displayTotalQty/);
  assert.match(lotsRoute, /displayAllocatedQty/);
  assert.match(lotsRoute, /weightPerCartonKg:\s*product\.unitOfMeasure === "PCS" \? null : product\.defaultWeightPerCartonKg/);
  assert.match(lotsRoute, /unitOfMeasure.*PCS/s);
  assert.match(lotsRoute, /qtyPcs/);
  assert.match(lotsRoute, /unitPriceUsdPerPcs/);
  assert.match(lotsRoute, /totalPriceUsd\s*=\s*round2\(purchaseQty\s*\*\s*unitPriceUsd\)/);

  assert.match(salesRoute, /cartonQty/);
  assert.match(salesRoute, /ratePerPieceLocal/);
  assert.match(salesRoute, /ratePerPieceUsd/);
  assert.match(salesRoute, /piecesPerCarton/);
  assert.match(salesRoute, /stockQty\s*=\s*cartonQty\s*\*\s*product\.piecesPerCarton/);
  assert.match(accounting, /pcsSaleItems/);
  assert.match(accounting, /averageUsdPerPiece/);
  assert.match(accounting, /Number\(item\.qty \|\| 0\) \* averageUsdPerPiece \* usdPkrRate/);

  assert.match(settingsPage, /unitOfMeasure/);
  assert.match(settingsPage, /defaultWeightPerCartonKg/);
  assert.match(settingsPage, /WT\/CRT \(KG\)/);
  assert.match(settingsPage, /packetsPerCarton/);
  assert.match(settingsPage, /Packets\/CTN/);
  assert.match(settingsPage, /piecesPerCarton/);
  assert.match(lotsPage, /PCS\/CTN/);
  assert.match(lotsPage, /WT\/CRT \(KG\)/);
  assert.match(lotsPage, /QTY \(PCS\)/);
  assert.match(lotsPage, /USD\/PCS/);
  assert.match(salesPage, /PKR\/PCS/);
  assert.match(salesPage, /AFN\/PCS/);
  assert.match(salesPage, /USD\/PCS/);
});
