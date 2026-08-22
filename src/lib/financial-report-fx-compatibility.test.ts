import test from "node:test";
import assert from "node:assert/strict";
import { summarizeJournalPnl } from "./authoritative-financial-report";
import { calculateHistoricalSaleProfitPkr } from "./historical-sale-profit";
import { buildHistoricalFxTransaction, buildHistoricalPoolPreview } from "./historical-pool-attribution";
import { buildInvestorAttributionPreview, type AttributionCapitalEvent } from "./investor-attribution";
import { buildFinalizationDryRun } from "./investor-finalization-dry-run";
import { normalizeSarafiAfSnapshot, resolveAfghanistanFxRate, SARAFI_AF_MARKET } from "./sarafi-af-snapshot";
import { isInvestorFinalizationEnabled, isInvestorFxSettlementEnabled, isInvestorSettlementEnabled } from "./investor-production-gate";

const accounts = [
  { id: 1, name: "Sales Revenue", accountType: "revenue" },
  { id: 2, name: "Cost of Goods Sold", accountType: "cogs" },
  { id: 3, name: "Office Expenses", accountType: "expense" },
];

const capitalEvents: AttributionCapitalEvent[] = [
  { participantId: "manager", participantName: "Manager", participantType: "manager", effectiveDate: "2026-01-01", amountPkr: 20_000_000, eventType: "opening" },
  { participantId: "investor", participantName: "Investor", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 20_000_000, eventType: "opening", investorProfitSharePercent: 50 },
];

async function verifyChain(input: { financialResultPkr: number; historicalAmountPkr: number }) {
  const attribution = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    getBusinessResult: async () => ({ netBusinessProfitPkr: input.financialResultPkr }),
  });
  const historicalPool = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    transactions: [{
      sourceType: "sale_profit",
      sourceId: "controlled-sale",
      recognizedDate: "2026-01-10",
      originalPoolDate: "2026-01-10",
      amountPkr: input.historicalAmountPkr,
    }],
  });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview: historicalPool });

  assert.equal(attribution.reconciliationDifferencePkr, 0);
  assert.equal(historicalPool.aggregateReconciliation.reconciliationDifferencePkr, 0);
  assert.equal(dryRun.postingSimulation.reconciliation.snapshotToHistoricalDifferencePkr, 0);
  assert.equal(dryRun.postingSimulation.reconciliation.historicalToFinancialReportDifferencePkr, 0);
}

test("one profit truth: Pakistan PKR sale reconciles through Financial Report, pool, and attribution", async () => {
  const financial = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
  });
  const saleProfit = calculateHistoricalSaleProfitPkr({ saleId: 1, saleCurrencyCode: "PKR", saleTotalAmount: 1000, itemAmount: 1000, itemQty: 1, landedCostPerCartonPkr: 800 });

  assert.equal(financial.profitAndLoss.netProfit, 200);
  assert.equal(saleProfit.profitPkr, 200);
  await verifyChain({ financialResultPkr: 200, historicalAmountPkr: 200 });
});

test("Afghanistan AFN sale preserves raw AFN while recognizing PKR from Sarai Shahzada metadata", async () => {
  const snapshot = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-01-10",
    fetchedAt: new Date("2026-01-10T04:00:00.000Z"),
    sourceTimestamp: new Date("2026-01-10T03:55:00.000Z"),
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 250, rawUnit: "1K" },
      { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 10, rawSellRate: 10, rawUnit: "1" },
    ],
  });
  const afnRate = resolveAfghanistanFxRate({
    currencyCode: "AFN",
    transactionDate: "2026-01-10",
    purpose: "sale_recognition",
    positionKind: "asset",
    sarafiRates: snapshot.derivedRates.map((rate) => ({
      snapshotDate: snapshot.snapshotDate,
      providerReference: `sarafi:${rate.fromCurrencyCode}`,
      fromCurrencyCode: rate.fromCurrencyCode,
      toCurrencyCode: rate.toCurrencyCode,
      buyRate: rate.buyRate,
      sellRate: rate.sellRate,
      sourceTimestamp: snapshot.sourceTimestamp,
      fetchedTimestamp: snapshot.fetchedAt,
      conversionPath: rate.conversionPath,
      status: snapshot.status,
    })),
    manualRates: [],
  });

  assert.equal(snapshot.market, SARAFI_AF_MARKET);
  assert.equal(afnRate.ok, true);
  assert.equal(afnRate.ok && afnRate.rate, 4);
  const saleProfit = calculateHistoricalSaleProfitPkr({ saleId: 2, saleCurrencyCode: "AFN", saleTotalAmount: 1000, saleFxPkrEquivalent: 4000, itemAmount: 1000, itemQty: 1, landedCostPerCartonPkr: 800 });
  const financial = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "AFN", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
    recognizedSalePkrById: new Map([[2, 4000]]),
  });

  assert.equal(saleProfit.profitPkr, 3200);
  assert.equal(financial.profitAndLoss.netProfit, 3200);
  assert.notEqual(financial.profitAndLoss.totalRevenue, 1000);
  await verifyChain({ financialResultPkr: 3200, historicalAmountPkr: 3200 });
});

test("Afghanistan USD sale keeps USD original and exposes USD→AFN→PKR conversion path", async () => {
  const snapshot = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-01-10",
    fetchedAt: new Date("2026-01-10T04:00:00.000Z"),
    sourceTimestamp: new Date("2026-01-10T03:55:00.000Z"),
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 70, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 250, rawUnit: "1K" },
      { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 10, rawSellRate: 10, rawUnit: "1" },
    ],
  });
  const usd = snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "USD")!;
  assert.deepEqual(usd.conversionPath, ["USD→AFN", "AFN→PKR"]);
  assert.equal(usd.buyRate, 280);

  const saleProfit = calculateHistoricalSaleProfitPkr({ saleId: 3, saleCurrencyCode: "USD", saleTotalAmount: 10, saleFxPkrEquivalent: 2800, itemAmount: 10, itemQty: 1, landedCostPerCartonPkr: 800 });
  assert.equal(saleProfit.profitPkr, 2000);
  await verifyChain({ financialResultPkr: 2000, historicalAmountPkr: 2000 });
});

test("CNY is canonical for RMB and does not create duplicate currency meaning", () => {
  const snapshot = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-01-10",
    fetchedAt: new Date("2026-01-10T04:00:00.000Z"),
    sourceTimestamp: new Date("2026-01-10T03:55:00.000Z"),
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 70, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 250, rawUnit: "1K" },
      { baseCurrencyCode: "RMB", quoteCurrencyCode: "AFN", rawBuyRate: 10, rawSellRate: 10, rawUnit: "1" },
    ],
  });

  assert.equal(snapshot.quotes.some((quote) => quote.baseCurrencyCode === "RMB"), false);
  assert.equal(snapshot.quotes.some((quote) => quote.baseCurrencyCode === "CNY"), true);
  assert.equal(snapshot.derivedRates.filter((rate) => rate.fromCurrencyCode === "CNY").length, 1);
});

test("expenses reduce authoritative profit once and foreign expense without metadata is blocked from guessing", () => {
  const pkr = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
      { accountId: 3, currencyCode: "PKR", _sum: { debit: 50, credit: 0 } },
    ],
  });
  const afn = summarizeJournalPnl({
    accounts,
    groups: [{ accountId: 3, currencyCode: "AFN", _sum: { debit: 50, credit: 0 } }],
  });

  assert.equal(pkr.profitAndLoss.netProfit, 150);
  assert.equal(afn.profitAndLoss.netProfit, 0);
  assert.match(afn.unsupportedForeignCurrencyEntries.join(" "), /AFN expense/);
});

test("FX gain and loss appear once and attach to the historical pool", () => {
  const gain = buildHistoricalFxTransaction({ sourceId: "gain", sourcePosition: "USD settlement", recognizedDate: "2026-01-31", originalPoolDate: "2026-01-10", currencyCode: "USD", foreignAmount: 10_000, carryingRate: 400, valuationRate: 420, valuationDate: "2026-01-31" });
  const loss = buildHistoricalFxTransaction({ sourceId: "loss", sourcePosition: "USD settlement", recognizedDate: "2026-01-31", originalPoolDate: "2026-01-10", currencyCode: "USD", foreignAmount: 10_000, carryingRate: 400, valuationRate: 380, valuationDate: "2026-01-31" });

  assert.equal(gain.amountPkr, 200_000);
  assert.equal(loss.amountPkr, -200_000);
  const pool = buildHistoricalPoolPreview({ periodStart: "2026-01-01", periodEnd: "2026-01-31", capitalEvents, transactions: [gain, loss] });
  assert.equal(pool.aggregateReconciliation.recognizedAmountPkr, 0);
  assert.equal(pool.transactionLinks.filter((link) => link.sourceType === "fx_gain_loss").length, 2);
  assert.equal(pool.aggregateReconciliation.reconciliationDifferencePkr, 0);
});

test("unpaid sale remains profit-recognized and later receipt does not add profit", async () => {
  const collected = 0;
  const financial = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 800, credit: 0 } },
    ],
  });

  assert.equal(collected, 0);
  assert.equal(financial.profitAndLoss.netProfit, 200);
  await verifyChain({ financialResultPkr: 200, historicalAmountPkr: 200 });

  const laterReceiptOnly = summarizeJournalPnl({
    accounts,
    groups: [],
  });
  assert.equal(laterReceiptOnly.profitAndLoss.netProfit, 0);
});

test("investor settlement flags are disabled by default and settlement is not P&L", () => {
  assert.equal(isInvestorFinalizationEnabled({}), false);
  assert.equal(isInvestorSettlementEnabled({}), false);
  assert.equal(isInvestorFxSettlementEnabled({}), false);

  const financial = summarizeJournalPnl({
    accounts,
    groups: [
      { accountId: 99, currencyCode: "PKR", _sum: { debit: 1_000_000, credit: 0 } },
      { accountId: 100, currencyCode: "PKR", _sum: { debit: 0, credit: 1_000_000 } },
    ],
  });
  assert.equal(financial.profitAndLoss.netProfit, 0);
});
