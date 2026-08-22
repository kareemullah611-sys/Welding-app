import test from "node:test";
import assert from "node:assert/strict";
import { buildMissingCogsWarnings, summarizeJournalPnl } from "./authoritative-financial-report";

const accounts = [
  { id: 1, name: "Sales Revenue", accountType: "revenue" },
  { id: 2, name: "Cost of Goods Sold", accountType: "cogs" },
  { id: 3, name: "Office Expenses", accountType: "expense" },
];

test("authoritative P&L uses PKR journals and expenses for recognized profit", () => {
  const result = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
      { accountId: 3, currencyCode: "PKR", _sum: { debit: 50, credit: 0 } },
    ],
  });

  assert.equal(result.profitAndLoss.totalRevenue, 1000);
  assert.equal(result.profitAndLoss.totalCOGS, 800);
  assert.equal(result.profitAndLoss.totalExpenses, 50);
  assert.equal(result.profitAndLoss.netProfit, 150);
});

test("unpaid recognized sale can still create investor-attributable profit", () => {
  const result = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
  });

  assert.equal(result.profitAndLoss.netProfit, 200);
});

test("foreign raw journal amounts are not silently treated as PKR", () => {
  const result = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "AFN", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
  });

  assert.equal(result.profitAndLoss.totalRevenue, 0);
  assert.equal(result.profitAndLoss.netProfit, -800);
  assert.deepEqual(result.unsupportedForeignCurrencyEntries, [
    "AFN revenue journal entries require stored PKR recognition metadata before attribution.",
  ]);
});

test("stored FX recognition metadata supplies PKR sale revenue without using raw foreign amount", () => {
  const result = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "AFN", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
    recognizedSalePkrById: new Map([[99, 4000]]),
  });

  assert.equal(result.profitAndLoss.totalRevenue, 4000);
  assert.equal(result.profitAndLoss.netProfit, 3200);
  assert.match(result.unsupportedForeignCurrencyEntries.join(" "), /AFN revenue/);
});

test("active sale lot rows without COGS journals are blocked from clean finalization", () => {
  const warnings = buildMissingCogsWarnings({
    saleLotRows: [
      { saleId: 10, lotId: 649, voucherNo: "0058", lotNumber: "649" },
      { saleId: 10, lotId: 109, voucherNo: "0058", lotNumber: "109" },
      { saleId: 11, lotId: 649, voucherNo: "0059", lotNumber: "649" },
    ],
    cogsJournalRows: [
      { transactionId: "COGS-10", lotId: 109 },
    ],
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Missing COGS journal for 2 active sale\/lot rows/);
  assert.match(warnings[0], /sale 0058 lot 649/);
  assert.match(warnings[0], /sale 0059 lot 649/);
});
