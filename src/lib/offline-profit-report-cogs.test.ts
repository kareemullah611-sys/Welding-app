import test from "node:test";
import assert from "node:assert/strict";

import { applyPendingProfitReportPeriod } from "@/lib/offline-profit-report";

function queued(url: string, body: Record<string, unknown>) {
  return { url, method: "POST", body: JSON.stringify(body) };
}

function periodBase() {
  return {
    cartonsSold: 40,
    reportingCurrency: "PKR",
    profitAndLoss: {
      totalRevenue: 100000,
      totalCOGS: 60000,
      grossProfit: 40000,
      totalExpenses: 10000,
      netProfit: 30000,
      grossMarginPercent: 40,
      netMarginPercent: 30,
    },
  };
}

test("queued sale must not be treated as zero-COGS revenue", () => {
  const result = applyPendingProfitReportPeriod(periodBase(), [
    queued("/api/v1/sales", {
      saleDate: "2026-03-05",
      totalAmount: 20000,
      items: [{ qty: 5, ratePerCarton: 4000 }],
    }),
  ], { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

  const pl = result.profitAndLoss;
  // Revenue and cartons do rise for a queued sale.
  assert.equal(pl.totalRevenue, 120000);
  assert.equal(result.cartonsSold, 45);
  // Gross profit may only move by the amount of unposted COGS on that sale. Adding the
  // full sale amount as profit (assuming zero COGS) inflates profit by the whole 20000.
  assert.notEqual(pl.grossProfit, 60000, "queued sale must not add its full value to gross profit");
});

test("queued sale with no derivable COGS leaves profit untouched and says so", () => {
  const result = applyPendingProfitReportPeriod(periodBase(), [
    queued("/api/v1/sales", {
      saleDate: "2026-03-05",
      totalAmount: 20000,
      items: [{ qty: 5, ratePerCarton: 4000 }],
    }),
  ], { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

  const pl = result.profitAndLoss;
  assert.equal(pl.grossProfit, 40000, "gross profit stays at posted value when COGS is unknown");
  assert.equal(pl.netProfit, 30000);
  assert.equal(
    result.pendingCogsUnposted,
    true,
    "the report must disclose that queued sales have no recognized COGS"
  );
});

test("queued expense reduces net profit without touching gross profit", () => {
  const result = applyPendingProfitReportPeriod(periodBase(), [
    queued("/api/v1/expenses", { expenseDate: "2026-03-05", amount: 5000 }),
  ], { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

  const pl = result.profitAndLoss;
  assert.equal(pl.totalExpenses, 15000);
  assert.equal(pl.netProfit, 25000);
  assert.equal(pl.grossProfit, 40000);
});

test("queued sale outside the period does not affect the period", () => {
  const result = applyPendingProfitReportPeriod(periodBase(), [
    queued("/api/v1/sales", { saleDate: "2025-01-05", totalAmount: 20000, items: [{ qty: 5 }] }),
  ], { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

  assert.equal(result.profitAndLoss.totalRevenue, 100000);
});

test("gross margin reflects the unposted-COGS disclosure rather than overstating", () => {
  const result = applyPendingProfitReportPeriod(periodBase(), [
    queued("/api/v1/sales", { saleDate: "2026-03-05", totalAmount: 20000, items: [{ qty: 5, ratePerCarton: 4000 }] }),
  ], { dateFrom: "2026-03-01", dateTo: "2026-03-31" });

  const pl = result.profitAndLoss;
  assert.equal(pl.grossMarginPercent, Number(((40000 / 120000) * 100).toFixed(2)));
});
