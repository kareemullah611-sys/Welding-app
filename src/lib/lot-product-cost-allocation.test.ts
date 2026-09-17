import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateLotCostAcrossProducts,
  calculateLotProductLandedCosts,
  defaultLotCostAllocationBasis,
  type LotProductCostInput,
} from "./lot-product-cost-allocation";

const products: LotProductCostInput[] = [
  {
    productId: 1,
    productName: "3.2mm",
    purchaseValuePkr: 600_000,
    weightKg: 6_000,
    cartonQty: 300,
    totalStockQty: 300,
    operatingSoldStockQty: 180,
    openingSoldStockQty: 30,
  },
  {
    productId: 2,
    productName: "4.0mm",
    purchaseValuePkr: 400_000,
    weightKg: 4_000,
    cartonQty: 200,
    totalStockQty: 200,
    operatingSoldStockQty: 50,
    openingSoldStockQty: 0,
  },
];

test("approved cost types map to the configured product allocation basis", () => {
  assert.equal(defaultLotCostAllocationBasis("customs_duty"), "purchase_value");
  assert.equal(defaultLotCostAllocationBasis("freight"), "weight");
  assert.equal(defaultLotCostAllocationBasis("transport"), "weight");
  assert.equal(defaultLotCostAllocationBasis("loading_unloading"), "cartons");
  assert.equal(defaultLotCostAllocationBasis("other"), null);
});

test("customs duty allocates by product purchase value and then by sold state", () => {
  const result = allocateLotCostAcrossProducts({
    amountPkr: 100_000,
    basis: "purchase_value",
    products,
  });

  assert.deepEqual(result, [
    {
      productId: 1,
      productName: "3.2mm",
      allocatedCostPkr: 60_000,
      operatingCogsPkr: 36_000,
      historicalAdjustmentPkr: 6_000,
      inventoryPkr: 18_000,
    },
    {
      productId: 2,
      productName: "4.0mm",
      allocatedCostPkr: 40_000,
      operatingCogsPkr: 10_000,
      historicalAdjustmentPkr: 0,
      inventoryPkr: 30_000,
    },
  ]);
});

test("transport allocates by product weight", () => {
  const result = allocateLotCostAcrossProducts({ amountPkr: 50_000, basis: "weight", products });
  assert.deepEqual(result.map((row) => row.allocatedCostPkr), [30_000, 20_000]);
});

test("loading and unloading allocates by cartons", () => {
  const result = allocateLotCostAcrossProducts({ amountPkr: 25_000, basis: "cartons", products });
  assert.deepEqual(result.map((row) => row.allocatedCostPkr), [15_000, 10_000]);
});

test("specific product cost applies only to the selected child product", () => {
  const result = allocateLotCostAcrossProducts({
    amountPkr: 20_000,
    basis: "specific_product",
    allocatedProductId: 2,
    products,
  });
  assert.deepEqual(result.map((row) => row.allocatedCostPkr), [0, 20_000]);
});

test("allocation keeps the exact PKR rounding remainder", () => {
  const equalProducts = products.map((product) => ({
    ...product,
    purchaseValuePkr: 1,
    operatingSoldStockQty: 0,
    openingSoldStockQty: 0,
  }));
  const result = allocateLotCostAcrossProducts({ amountPkr: 100, basis: "purchase_value", products: equalProducts });
  assert.equal(result.reduce((sum, row) => sum + row.allocatedCostPkr, 0), 100);
});

test("weight allocation blocks instead of guessing when product weight is unavailable", () => {
  assert.throws(() => allocateLotCostAcrossProducts({
    amountPkr: 100,
    basis: "weight",
    products: [{ ...products[0], weightKg: 0 }],
  }), /weight/i);
});

test("allocation rejects child sales above the corrected product quantity", () => {
  assert.throws(() => allocateLotCostAcrossProducts({
    amountPkr: 100,
    basis: "cartons",
    products: [{ ...products[0], operatingSoldStockQty: 301 }],
  }), /exceed/i);
});

test("product landed cost combines purchase basis and each cost allocation rule", () => {
  const result = calculateLotProductLandedCosts({
    products,
    costs: [
      { amountPkr: 100_000, basis: "purchase_value" },
      { amountPkr: 50_000, basis: "weight" },
      { amountPkr: 25_000, basis: "cartons" },
      { amountPkr: 20_000, basis: "specific_product", allocatedProductId: 2 },
    ],
  });

  assert.deepEqual(result.map((row) => ({
    productId: row.productId,
    additionalCostPkr: row.additionalCostPkr,
    totalLandedCostPkr: row.totalLandedCostPkr,
    unitCostPkr: row.unitCostPkr,
  })), [
    { productId: 1, additionalCostPkr: 105_000, totalLandedCostPkr: 705_000, unitCostPkr: 2_350 },
    { productId: 2, additionalCostPkr: 90_000, totalLandedCostPkr: 490_000, unitCostPkr: 2_450 },
  ]);
});
