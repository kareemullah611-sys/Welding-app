import test from "node:test";
import assert from "node:assert/strict";
import { parseOfflineSeedBundle } from "@/lib/offline-seed-bootstrap";
import { buildOfflineStockLedgerFromModules } from "@/lib/offline-stock-ledger";
import { buildOfflineLotProfitFromModules } from "@/lib/offline-lot-profit";

test("parseOfflineSeedBundle rejects empty modules", () => {
  assert.equal(parseOfflineSeedBundle({ version: 1, modules: {} }), null);
  assert.equal(parseOfflineSeedBundle({ version: 1, modules: { counts: {}, syncedAt: "x" } }), null);
});

test("parseOfflineSeedBundle accepts modules with rows", () => {
  const parsed = parseOfflineSeedBundle({
    version: 1,
    modules: { customers: [{ id: 1, name: "Ali" }] },
  });
  assert.ok(parsed);
  assert.equal((parsed!.customers as unknown[]).length, 1);
});

test("buildOfflineStockLedgerFromModules computes running stock", () => {
  const rows = buildOfflineStockLedgerFromModules(
    {
      openingStocks: [{
        openingDate: "2026-01-01",
        godownId: 1,
        productId: 2,
        qty: 100,
        godown: { name: "Main" },
        product: { name: "Rod" },
      }],
      sales: [{
        status: "active",
        voucherNo: "S-1",
        saleDate: "2026-01-02",
        godownId: 1,
        items: [{ productId: 2, qty: 30, product: { name: "Rod" } }],
      }],
    },
    { godown_id: 1, product_id: 2 }
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].runningStock, 70);
});

test("approved city transfers are reflected once when synced allocations already moved", () => {
  const sourceRows = buildOfflineStockLedgerFromModules(
    {
      lots: [{
        lotNumber: "L-1",
        lotDate: "2026-01-01",
        distributions: [{
          productId: 2,
          productName: "Rod",
          godownAllocations: [{ godownId: 1, godownName: "Ravi", qty: 450 }],
        }],
      }],
      cityTransfers: [{
        status: "approved",
        transferDate: "2026-01-02",
        productId: 2,
        fromGodownId: 1,
        toGodownId: 2,
        qty: 200,
        product: { name: "Rod" },
      }],
    },
    { godown_id: 1, product_id: 2 },
  );
  const destinationRows = buildOfflineStockLedgerFromModules(
    {
      lots: [{
        lotNumber: "L-1",
        lotDate: "2026-01-01",
        distributions: [{
          productId: 2,
          productName: "Rod",
          godownAllocations: [{ godownId: 2, godownName: "Quetta", qty: 200 }],
        }],
      }],
      cityTransfers: [{
        status: "approved",
        transferDate: "2026-01-02",
        productId: 2,
        fromGodownId: 1,
        toGodownId: 2,
        qty: 200,
        product: { name: "Rod" },
      }],
    },
    { godown_id: 2, product_id: 2 },
  );

  assert.equal(sourceRows[0].type, "city_transfer");
  assert.equal(sourceRows[0].runningStock, 450);
  assert.equal(destinationRows[0].type, "city_transfer");
  assert.equal(destinationRows[0].runningStock, 200);
});

test("buildOfflineLotProfitFromModules returns lot profit summary", () => {
  const report = buildOfflineLotProfitFromModules({
    lotId: 5,
    lots: [{ id: 5, lotNumber: "L-5", lotDate: "2026-01-01", countryName: "PK", status: "ongoing", pkrExchangeRate: 280, products: [{ productId: 1, totalQty: 100 }] }],
    lotPurchases: [{ lotId: 5, productId: 1, totalPriceUsd: 1000, qty: 1, product: { name: "Rod" }, supplier: { name: "Sup" } }],
    lotCosts: [],
    sales: [{ lotId: 5, status: "active", cityId: 1, items: [{ productId: 1, qty: 10, amount: 500 }] }],
    expenses: [],
    cityScope: null,
  });
  assert.ok(report);
  assert.equal((report!.lot as { lotNumber: string }).lotNumber, "L-5");
  assert.equal((report!.profitSummary as { netRevenue: number }).netRevenue, 500);
});
