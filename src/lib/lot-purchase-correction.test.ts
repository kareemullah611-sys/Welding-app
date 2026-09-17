import assert from "node:assert/strict";
import test from "node:test";
import { buildLotPurchaseCorrectionDeltas } from "./lot-purchase-correction";

const base = {
  productId: 1,
  productName: "3.2mm",
  purchaseValuePkr: 1_000,
  weightKg: 1_000,
  cartonQty: 100,
  totalStockQty: 100,
  operatingSoldStockQty: 60,
  openingSoldStockQty: 20,
  additionalCostPkr: 0,
  totalLandedCostPkr: 1_000,
  unitCostPkr: 10,
  operatingCogsPkr: 600,
  historicalAdjustmentPkr: 200,
  inventoryPkr: 200,
};

test("purchase price increase posts delta to sold COGS, opening adjustment, inventory, and supplier", () => {
  const result = buildLotPurchaseCorrectionDeltas({
    beforeProducts: [base],
    afterProducts: [{
      ...base,
      purchaseValuePkr: 1_500,
      totalLandedCostPkr: 1_500,
      unitCostPkr: 15,
      operatingCogsPkr: 900,
      historicalAdjustmentPkr: 300,
      inventoryPkr: 300,
    }],
    beforeSupplierBalances: new Map([[10, 1_000]]),
    afterSupplierBalances: new Map([[10, 1_500]]),
  });
  assert.deepEqual(result.productDeltas, [{
    productId: 1,
    productName: "3.2mm",
    operatingCogsPkr: 300,
    historicalAdjustmentPkr: 100,
    inventoryPkr: 100,
  }]);
  assert.deepEqual(result.supplierDeltas, [{ supplierId: 10, payablePkr: 500 }]);
  assert.equal(result.reconciliationDifferencePkr, 0);
});

test("supplier reassignment moves payable without changing inventory or profit", () => {
  const result = buildLotPurchaseCorrectionDeltas({
    beforeProducts: [base],
    afterProducts: [base],
    beforeSupplierBalances: new Map([[10, 1_000]]),
    afterSupplierBalances: new Map([[20, 1_000]]),
  });
  assert.deepEqual(result.productDeltas, []);
  assert.deepEqual(result.supplierDeltas, [
    { supplierId: 10, payablePkr: -1_000 },
    { supplierId: 20, payablePkr: 1_000 },
  ]);
  assert.equal(result.reconciliationDifferencePkr, 0);
});

test("quantity correction below sold quantities is blocked before journal construction", () => {
  assert.throws(() => buildLotPurchaseCorrectionDeltas({
    beforeProducts: [base],
    afterProducts: [{ ...base, totalStockQty: 70, operatingSoldStockQty: 60, openingSoldStockQty: 20 }],
    beforeSupplierBalances: new Map([[10, 1_000]]),
    afterSupplierBalances: new Map([[10, 1_000]]),
  }), /exceed/i);
});
