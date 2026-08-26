import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("realized FX gains and losses are separate and included once in net profit", () => {
  const result = summarizeJournalPnl({
    accounts: [
      { id: 1, code: "3001", name: "Sales Revenue", accountType: "revenue" },
      { id: 2, code: "FX-GAIN", name: "Foreign Exchange Gain", accountType: "revenue" },
      { id: 3, code: "FX-LOSS", name: "Foreign Exchange Loss", accountType: "expense" },
    ],
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1_000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 0, credit: 200 } },
      { accountId: 3, currencyCode: "PKR", _sum: { debit: 50, credit: 0 } },
    ],
  });

  assert.equal(result.profitAndLoss.totalRevenue, 1_000);
  assert.equal(result.profitAndLoss.totalFxGains, 200);
  assert.equal(result.profitAndLoss.totalFxLosses, 50);
  assert.equal(result.profitAndLoss.netProfit, 1_150);
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
    recognizedForeignSaleAmountsByCurrency: new Map([["AFN", 1000]]),
  });

  assert.equal(result.profitAndLoss.totalRevenue, 4000);
  assert.equal(result.profitAndLoss.netProfit, 3200);
  assert.deepEqual(result.unsupportedForeignCurrencyEntries, []);
});

test("foreign revenue remains blocked when stored PKR recognition metadata does not cover it", () => {
  const result = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "USD", _sum: { debit: 0, credit: 1000 } },
    ],
    recognizedSalePkrById: new Map([[100, 140_000]]),
    recognizedForeignSaleAmountsByCurrency: new Map([["USD", 500]]),
  });

  assert.equal(result.profitAndLoss.totalRevenue, 140_000);
  assert.match(result.unsupportedForeignCurrencyEntries.join(" "), /USD revenue/);
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

test("historical opening imports are excluded from operating COGS completeness warnings", () => {
  const source = readFileSync("src/lib/authoritative-financial-report.ts", "utf8");
  const saleItemsQuery = source.slice(
    source.indexOf("prisma.saleItem.findMany"),
    source.indexOf("prisma.journalEntry.findMany", source.indexOf("prisma.saleItem.findMany")),
  );

  assert.match(saleItemsQuery, /isOpeningImport:\s*false/);
});
