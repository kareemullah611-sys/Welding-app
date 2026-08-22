import test from "node:test";
import assert from "node:assert/strict";
import { calculateHistoricalSaleProfitPkr } from "./historical-sale-profit";

test("Pakistan PKR sale profit uses direct PKR revenue", () => {
  const result = calculateHistoricalSaleProfitPkr({
    saleId: 1,
    saleCurrencyCode: "PKR",
    saleTotalAmount: 1000,
    itemAmount: 1000,
    itemQty: 1,
    landedCostPerCartonPkr: 800,
  });

  assert.equal(result.ok, true);
  assert.equal(result.profitPkr, 200);
});

test("Afghanistan AFN sale profit uses stored PKR recognition metadata, not raw AFN", () => {
  const result = calculateHistoricalSaleProfitPkr({
    saleId: 2,
    saleCurrencyCode: "AFN",
    saleTotalAmount: 1000,
    saleFxPkrEquivalent: 4000,
    itemAmount: 1000,
    itemQty: 1,
    landedCostPerCartonPkr: 800,
  });

  assert.equal(result.ok, true);
  assert.equal(result.revenuePkr, 4000);
  assert.equal(result.profitPkr, 3200);
});

test("Afghanistan USD sale allocates PKR recognition proportionally across items", () => {
  const result = calculateHistoricalSaleProfitPkr({
    saleId: 3,
    saleCurrencyCode: "USD",
    saleTotalAmount: 100,
    saleFxPkrEquivalent: 28000,
    itemAmount: 25,
    itemQty: 1,
    landedCostPerCartonPkr: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.revenuePkr, 7000);
  assert.equal(result.profitPkr, 2000);
});

test("RMB is canonicalized to CNY and requires FX recognition metadata", () => {
  const result = calculateHistoricalSaleProfitPkr({
    saleId: 4,
    saleCurrencyCode: "RMB",
    saleTotalAmount: 100,
    itemAmount: 100,
    itemQty: 1,
    landedCostPerCartonPkr: 800,
  });

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.missingReason : "", /CNY revenue requires stored PKR FX recognition metadata/);
});
