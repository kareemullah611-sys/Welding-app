import test from "node:test";
import assert from "node:assert/strict";

import { buildOfflineLotProfitFromModules } from "@/lib/offline-lot-profit";

/**
 * mapLotForOffline lives inside the server payload builder and needs a live DB, so
 * these fixtures mirror its exact output shape. Any field the offline lot profit
 * report reads must appear here, otherwise offline profit silently misreports.
 */
function offlineLotShape(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    lotNumber: "L-5",
    lotDate: "2026-01-01",
    notes: "",
    status: "ongoing",
    isLegacyStock: false,
    countryId: 1,
    countryName: "Pakistan",
    pkrExchangeRate: 280,
    products: [{ productId: 1, productName: "Rod", totalQty: 100 }],
    distributions: [],
    totalCartons: 100,
    soldCartons: 0,
    ...overrides,
  };
}

function purchases() {
  return [
    {
      id: 1,
      lotId: 5,
      productId: 1,
      totalPriceUsd: 1000,
      unitPriceUsd: 100,
      qty: 1,
      weightPerCartonKg: 100,
      product: { name: "Rod" },
      supplier: { name: "Sup" },
    },
  ];
}

test("offline lot profit computes PKR landed cost from the serialized FX rate", () => {
  const report = buildOfflineLotProfitFromModules({
    lotId: 5,
    lots: [offlineLotShape()],
    lotPurchases: purchases(),
    lotCosts: [],
    sales: [],
    cityScope: null,
  });

  assert.ok(report, "expected a lot profit report");
  const product = (report!.productCosts as Record<string, unknown>[])[0];
  // 1000 USD at 280 PKR = 280,000 PKR across 10 cartons (1 MT / 100 kg).
  assert.equal(product.totalLandedCostPkr, 280000);
  assert.equal(product.landedCostPerCartonPkr, 28000);
});

test("offline lot profit does not fabricate a USD rate when the FX rate is absent", () => {
  const report = buildOfflineLotProfitFromModules({
    lotId: 5,
    lots: [offlineLotShape({ pkrExchangeRate: undefined })],
    lotPurchases: purchases(),
    lotCosts: [],
    sales: [],
    cityScope: null,
  });

  // Missing FX rate must not silently produce a confident USD figure.
  assert.equal(report, null);
});

test("offline lot profit stays quiet for a lot with no purchase value and no rate", () => {
  const report = buildOfflineLotProfitFromModules({
    lotId: 5,
    lots: [offlineLotShape({ pkrExchangeRate: undefined })],
    lotPurchases: [],
    lotCosts: [],
    sales: [],
    cityScope: null,
  });

  assert.ok(report, "a rate-less lot with no USD value is reportable");
  const summary = report!.profitSummary as Record<string, number>;
  assert.equal(summary.totalRevenue, 0);
  assert.equal(summary.totalGrossProfit, 0);
});
