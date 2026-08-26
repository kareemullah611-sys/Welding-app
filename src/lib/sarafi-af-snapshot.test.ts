import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSarafiAfScheduledSnapshotDate,
  normalizeSarafiAfSnapshot,
  resolveAfghanistanFxRate,
  SARAFI_AF_MARKET,
  type SarafiAfStoredRateSource,
} from "./sarafi-af-snapshot";

const fetchedAt = new Date("2026-08-16T04:00:00.000Z");
const sourceTimestamp = new Date("2026-08-16T03:55:00.000Z");

test("sarafi snapshot uses Asia/Kabul accounting date and 08:30 schedule", () => {
  const scheduled = buildSarafiAfScheduledSnapshotDate(new Date("2026-08-15T20:10:00.000Z"));

  assert.equal(scheduled.snapshotDate, "2026-08-16");
  assert.equal(scheduled.scheduledTime, "08:30");
  assert.equal(scheduled.timezone, "Asia/Kabul");
});

test("sarafi snapshot normalizes PKR 1K quote and derives AFN USD and CNY to PKR", () => {
  const snapshot = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-08-16",
    fetchedAt,
    sourceTimestamp,
    rawReference: "sarafi-af:test",
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 252, rawUnit: "1K" },
      { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 9.7, rawSellRate: 9.9, rawUnit: "1" },
    ],
  });

  assert.equal(snapshot.status, "VALID_CURRENT");
  assert.equal(snapshot.market, SARAFI_AF_MARKET);
  assert.equal(snapshot.quotes.find((quote) => quote.baseCurrencyCode === "PKR")?.normalizationFactor, 1000);
  assert.equal(snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "AFN")?.buyRate, 3.968254);
  assert.equal(snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "AFN")?.sellRate, 4);
  assert.deepEqual(snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "USD")?.conversionPath, ["USD→AFN", "AFN→PKR"]);
  assert.equal(snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "USD")?.buyRate, 277.77778);
  assert.equal(snapshot.derivedRates.find((rate) => rate.fromCurrencyCode === "CNY")?.buyRate, 38.492064);
});

test("sarafi snapshot preserves buy and sell rates for assets and liabilities", () => {
  const snapshot = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-08-16",
    fetchedAt,
    sourceTimestamp,
    rawReference: "sarafi-af:test",
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 252, rawUnit: "1K" },
      { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 9.7, rawSellRate: 9.9, rawUnit: "1" },
    ],
  });
  const sources: SarafiAfStoredRateSource[] = snapshot.derivedRates.map((rate) => ({
    snapshotDate: snapshot.snapshotDate,
    providerReference: `sarafi_fx_snapshot_derived_rates:${rate.fromCurrencyCode}`,
    fromCurrencyCode: rate.fromCurrencyCode,
    toCurrencyCode: rate.toCurrencyCode,
    buyRate: rate.buyRate,
    sellRate: rate.sellRate,
    sourceTimestamp: sourceTimestamp.toISOString(),
    fetchedTimestamp: fetchedAt.toISOString(),
    conversionPath: rate.conversionPath,
    status: snapshot.status,
  }));

  const asset = resolveAfghanistanFxRate({
    currencyCode: "USD",
    transactionDate: "2026-08-16",
    purpose: "sale_recognition",
    positionKind: "asset",
    sarafiRates: sources,
    manualRates: [],
  });
  const liability = resolveAfghanistanFxRate({
    currencyCode: "USD",
    transactionDate: "2026-08-16",
    purpose: "settlement",
    positionKind: "liability",
    sarafiRates: sources,
    manualRates: [],
  });

  assert.equal(asset.ok, true);
  assert.equal(asset.ok && asset.selectedRateType, "buy");
  assert.equal(asset.ok && asset.rate, 277.77778);
  assert.equal(liability.ok, true);
  assert.equal(liability.ok && liability.selectedRateType, "sell");
  assert.equal(liability.ok && liability.rate, 284);
});

test("actual documented rate overrides sarafi snapshot and manual fallback", () => {
  const result = resolveAfghanistanFxRate({
    currencyCode: "AFN",
    transactionDate: "2026-08-16",
    purpose: "settlement",
    positionKind: "asset",
    actualDocumentedRate: {
      rate: 4.1,
      reference: "cash-exchange-slip-9",
    },
    sarafiRates: [{
      snapshotDate: "2026-08-16",
      providerReference: "sarafi:afn",
      fromCurrencyCode: "AFN",
      toCurrencyCode: "PKR",
      buyRate: 4,
      sellRate: 4.1,
      sourceTimestamp: sourceTimestamp.toISOString(),
      fetchedTimestamp: fetchedAt.toISOString(),
      conversionPath: ["AFN→PKR"],
      status: "VALID_CURRENT",
    }],
    manualRates: [{ rate: 3.9, effectiveFrom: "2026-08-01", providerReference: "manual:afn" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.provider, "ACTUAL_DOCUMENTED_TRANSACTION_RATE");
  assert.equal(result.ok && result.rate, 4.1);
});

test("resolver blocks missing or stale sarafi snapshot instead of guessing", () => {
  const stale = resolveAfghanistanFxRate({
    currencyCode: "CNY",
    transactionDate: "2026-08-16",
    purpose: "sale_recognition",
    positionKind: "asset",
    sarafiRates: [{
      snapshotDate: "2026-08-16",
      providerReference: "sarafi:cny",
      fromCurrencyCode: "CNY",
      toCurrencyCode: "PKR",
      buyRate: 38,
      sellRate: 40,
      sourceTimestamp: sourceTimestamp.toISOString(),
      fetchedTimestamp: fetchedAt.toISOString(),
      conversionPath: ["CNY→AFN", "AFN→PKR"],
      status: "STALE_SOURCE_RATE",
    }],
    manualRates: [],
  });
  const missing = resolveAfghanistanFxRate({
    currencyCode: "USD",
    transactionDate: "2026-08-15",
    purpose: "sale_recognition",
    positionKind: "asset",
    sarafiRates: [],
    manualRates: [],
  });

  assert.equal(stale.ok, false);
  assert.match(!stale.ok ? stale.missingReason : "", /stale/i);
  assert.equal(missing.ok, false);
  assert.match(!missing.ok ? missing.missingReason : "", /Missing USD→PKR/);
});

test("resolver uses the most recent previous valid Sarai Shahzada rate and never a future rate", () => {
  const result = resolveAfghanistanFxRate({
    currencyCode: "USD",
    transactionDate: "2026-08-16",
    purpose: "sale_recognition",
    positionKind: "liability",
    sarafiRates: [
      {
        snapshotDate: "2026-08-17",
        providerReference: "sarafi:future",
        fromCurrencyCode: "USD",
        toCurrencyCode: "PKR",
        buyRate: 290,
        sellRate: 291,
        sourceTimestamp: sourceTimestamp.toISOString(),
        fetchedTimestamp: fetchedAt.toISOString(),
        conversionPath: ["USD→AFN", "AFN→PKR"],
        status: "VALID_CURRENT",
      },
      {
        snapshotDate: "2026-08-14",
        providerReference: "sarafi:previous",
        fromCurrencyCode: "USD",
        toCurrencyCode: "PKR",
        buyRate: 284,
        sellRate: 285,
        sourceTimestamp: sourceTimestamp.toISOString(),
        fetchedTimestamp: fetchedAt.toISOString(),
        conversionPath: ["USD→AFN", "AFN→PKR"],
        status: "VALID_CURRENT",
      },
    ],
    manualRates: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.rate, 285);
  assert.equal(result.ok && result.rateSourceDate, "2026-08-14");
  assert.equal(result.ok && result.daysCarriedBackward, 2);
});

test("snapshot validation blocks parse failure and abnormal rate movement", () => {
  const missingPair = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-08-16",
    fetchedAt,
    sourceTimestamp,
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 252, rawUnit: "1K" },
    ],
  });
  const abnormal = normalizeSarafiAfSnapshot({
    snapshotDate: "2026-08-16",
    fetchedAt,
    sourceTimestamp,
    abnormalChangeThresholdPercent: 10,
    previousDerivedRates: [{ fromCurrencyCode: "USD", buyRate: 200, sellRate: 205 }],
    quotes: [
      { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
      { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 252, rawUnit: "1K" },
      { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 9.7, rawSellRate: 9.9, rawUnit: "1" },
    ],
  });

  assert.equal(missingPair.status, "VALIDATION_FAILED");
  assert.match(missingPair.validationWarnings.join(" "), /CNY\/AFN quote is required/);
  assert.equal(abnormal.status, "VALIDATION_FAILED");
  assert.match(abnormal.validationWarnings.join(" "), /changed more than 10%/);
});
