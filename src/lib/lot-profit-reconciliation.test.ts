import assert from "node:assert/strict";
import test from "node:test";

import { buildLotProfitReconciliation } from "./lot-profit-reconciliation";

test("allocates recognized PKR revenue across the actual item lots", () => {
  const result = buildLotProfitReconciliation({
    sales: [{
      saleId: 10,
      recognizedRevenuePkr: 1_000,
      items: [
        { lotId: 1, revenueWeight: 600, cartons: 6 },
        { lotId: 2, revenueWeight: 400, cartons: 4 },
      ],
    }],
    revenueAdjustments: [],
    cogsEntries: [
      { lotId: 1, amountPkr: 480 },
      { lotId: 2, amountPkr: 320 },
    ],
    expenseEntries: [],
    authoritative: {
      totalRevenue: 1_000,
      totalCOGS: 800,
      grossProfit: 200,
      totalExpenses: 0,
      totalFxGains: 0,
      totalFxLosses: 0,
      netProfit: 200,
    },
  });

  assert.equal(result.byLot.get(1)?.revenuePkr, 600);
  assert.equal(result.byLot.get(2)?.revenuePkr, 400);
  assert.equal(result.reconciliation.revenueDifferencePkr, 0);
  assert.equal(result.reconciliation.cogsDifferencePkr, 0);
  assert.equal(result.reconciliation.grossProfitDifferencePkr, 0);
});

test("uses recognized PKR value for a foreign sale and applies lot discounts once", () => {
  const result = buildLotProfitReconciliation({
    sales: [{
      saleId: 11,
      recognizedRevenuePkr: 280_000,
      items: [{ lotId: 3, revenueWeight: 1_000, cartons: 10 }],
    }],
    revenueAdjustments: [{ lotId: 3, amountPkr: -10_000, kind: "discount" }],
    cogsEntries: [{ lotId: 3, amountPkr: 200_000 }],
    expenseEntries: [],
    authoritative: {
      totalRevenue: 270_000,
      totalCOGS: 200_000,
      grossProfit: 70_000,
      totalExpenses: 0,
      totalFxGains: 0,
      totalFxLosses: 0,
      netProfit: 70_000,
    },
  });

  assert.equal(result.byLot.get(3)?.grossRevenuePkr, 280_000);
  assert.equal(result.byLot.get(3)?.discountsPkr, 10_000);
  assert.equal(result.byLot.get(3)?.revenuePkr, 270_000);
  assert.equal(result.reconciliation.revenueDifferencePkr, 0);
});

test("bridges direct and unallocated expenses plus FX to authoritative net profit", () => {
  const result = buildLotProfitReconciliation({
    sales: [{
      saleId: 12,
      recognizedRevenuePkr: 1_000,
      items: [{ lotId: 4, revenueWeight: 1_000, cartons: 10 }],
    }],
    revenueAdjustments: [],
    cogsEntries: [{ lotId: 4, amountPkr: 700 }],
    expenseEntries: [{ lotId: 4, amountPkr: 20 }],
    authoritative: {
      totalRevenue: 1_000,
      totalCOGS: 700,
      grossProfit: 300,
      totalExpenses: 100,
      totalFxGains: 30,
      totalFxLosses: 10,
      netProfit: 220,
    },
  });

  assert.equal(result.reconciliation.directLotExpensesPkr, 20);
  assert.equal(result.reconciliation.unallocatedExpensesPkr, 80);
  assert.equal(result.reconciliation.bridgedNetProfitPkr, 220);
  assert.equal(result.reconciliation.netProfitDifferencePkr, 0);
  assert.equal(result.reconciliation.status, "RECONCILED");
});

test("blocks reconciliation when posted COGS has no lot attribution", () => {
  const result = buildLotProfitReconciliation({
    sales: [{
      saleId: 13,
      recognizedRevenuePkr: 1_000,
      items: [{ lotId: 5, revenueWeight: 1_000, cartons: 10 }],
    }],
    revenueAdjustments: [],
    cogsEntries: [{ lotId: null, amountPkr: 800 }],
    expenseEntries: [],
    authoritative: {
      totalRevenue: 1_000,
      totalCOGS: 800,
      grossProfit: 200,
      totalExpenses: 0,
      totalFxGains: 0,
      totalFxLosses: 0,
      netProfit: 200,
    },
  });

  assert.equal(result.reconciliation.cogsDifferencePkr, 800);
  assert.equal(result.reconciliation.status, "BLOCKED");
});
