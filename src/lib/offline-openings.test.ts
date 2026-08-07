import assert from "node:assert/strict";
import test from "node:test";
import { applyPendingOpeningsData } from "@/lib/offline-openings";

test("applies queued opening entries to opening summaries", () => {
  const base: any = {
    currencies: [{ id: 1, code: "PKR", symbol: "Rs" }],
    customers: [{ id: 2, name: "Walk-in Customer" }],
    godowns: [{ id: 3, name: "Main Godown" }],
    products: [{ id: 4, name: "2.5mm" }],
    liabilityOptions: {
      suppliers: [{ id: 5, name: "Supplier A" }],
      shippingLines: [],
      agents: [],
      intermediaries: [],
    },
    openingCash: [],
    openingCustomerBalances: [],
    openingHajiBalances: [],
    openingStocks: [],
    openingLiabilities: [],
  };

  const queued: any[] = [
    { id: "a", url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "cash", currencyId: 1, amount: 1000 }) },
    { id: "b", url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "customer", customerId: 2, currencyId: 1, amount: 500 }) },
    { id: "c", url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "stock", godownId: 3, productId: 4, qty: 90 }) },
    { id: "d", url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "liability", liabilityType: "supplier", partyId: 5, currencyId: 1, amount: 700 }) },
    { id: "e", url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "haji", currencyId: 1, amount: 300 }) },
  ];

  const merged = applyPendingOpeningsData(base, queued);

  assert.equal(merged.openingCash.length, 1);
  assert.equal(merged.openingCustomerBalances.length, 1);
  assert.equal(merged.openingStocks.length, 1);
  assert.equal(merged.openingLiabilities.length, 1);
  assert.equal(merged.openingHajiBalances!.length, 1);
  assert.equal(merged.openingCash[0]._pending, true);
  assert.equal(merged.openingLiabilities[0].partyName, "Supplier A");
  assert.equal(merged.openingHajiBalances![0].currencyCode, "PKR");
});
