import assert from "node:assert/strict";
import test from "node:test";
import { journalLotCost } from "./accounting";
import { allocateLateLotCostPkr } from "./late-lot-cost-allocation";

test("late lot cost stays in inventory when no cartons are sold", () => {
  assert.deepEqual(allocateLateLotCostPkr({
    amountPkr: 100_000,
    totalCartons: 1_000,
    operatingSoldCartons: 0,
    openingSoldCartons: 0,
  }), {
    operatingCogsPkr: 0,
    historicalAdjustmentPkr: 0,
    inventoryPkr: 100_000,
  });
});

test("late lot cost splits operating sales, opening sales, and remaining inventory", () => {
  assert.deepEqual(allocateLateLotCostPkr({
    amountPkr: 100_000,
    totalCartons: 1_000,
    operatingSoldCartons: 600,
    openingSoldCartons: 250,
  }), {
    operatingCogsPkr: 60_000,
    historicalAdjustmentPkr: 25_000,
    inventoryPkr: 15_000,
  });
});

test("late lot cost fully reduces sold result when the lot is fully sold", () => {
  assert.deepEqual(allocateLateLotCostPkr({
    amountPkr: 100_000,
    totalCartons: 1_000,
    operatingSoldCartons: 1_000,
    openingSoldCartons: 0,
  }), {
    operatingCogsPkr: 100_000,
    historicalAdjustmentPkr: 0,
    inventoryPkr: 0,
  });
});

test("late lot cost rejects sold quantities above the lot quantity", () => {
  assert.throws(() => allocateLateLotCostPkr({
    amountPkr: 100_000,
    totalCartons: 1_000,
    operatingSoldCartons: 900,
    openingSoldCartons: 200,
  }), /exceed/i);
});

test("late lot cost assigns the rounding remainder to inventory", () => {
  assert.deepEqual(allocateLateLotCostPkr({
    amountPkr: 100,
    totalCartons: 3,
    operatingSoldCartons: 1,
    openingSoldCartons: 1,
  }), {
    operatingCogsPkr: 33.33,
    historicalAdjustmentPkr: 33.33,
    inventoryPkr: 33.34,
  });
});

test("lot cost journal posts sold, opening, and remaining shares against the selected source", async () => {
  const accountIds = new Map<string, number>();
  let journalRows: any[] = [];
  const db = {
    supplier: { findUnique: async () => ({ name: "Test Supplier" }) },
    account: { upsert: async ({ where }: any) => {
      if (!accountIds.has(where.code)) accountIds.set(where.code, accountIds.size + 1);
      return { id: accountIds.get(where.code) };
    } },
    lotProduct: { findMany: async () => [{ productId: 1, totalQty: 100, product: { name: "3.2mm", unitOfMeasure: "MT", piecesPerCarton: null, defaultWeightPerCartonKg: 20 } }] },
    lotPurchase: { findMany: async () => [{ productId: 1, qty: 2, totalPriceUsd: 100, carryingAmountPkr: 1_000, carryingRatePkr: 10, weightPerCartonKg: 20 }] },
    saleItem: { findMany: async () => [
      { productId: 1, qty: 60, sale: { isOpeningImport: false } },
      { productId: 1, qty: 20, sale: { isOpeningImport: true } },
    ] },
    journalEntry: {
      findMany: async () => [],
      createMany: async ({ data }: any) => { journalRows = data; },
    },
  } as any;

  await journalLotCost({
    id: 10,
    lotId: 20,
    costType: "customs_duty",
    allocationBasis: "purchase_value",
    amountPkr: 100,
    originalAmount: 100,
    originalCurrencyCode: "PKR",
    recognitionDate: new Date("2026-09-17"),
    journalVersion: 1,
    createdBy: 1,
    supplierId: 30,
  }, db);

  assert.deepEqual(journalRows.map((row) => ({
    accountId: row.accountId,
    debit: row.debit,
    credit: row.credit,
  })), [
    { accountId: accountIds.get("4001"), debit: 60, credit: 0 },
    { accountId: accountIds.get("3901"), debit: 20, credit: 0 },
    { accountId: accountIds.get("1100"), debit: 20, credit: 0 },
    { accountId: accountIds.get("2100-S30"), debit: 0, credit: 100 },
  ]);
});
