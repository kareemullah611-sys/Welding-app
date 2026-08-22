import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCrossRateToPkr,
  normalizeExchangeRateRow,
  normalizeSarafiAfRate,
  sarafiAfIntegrationStatus,
  selectRateForPosition,
} from "./exchange-rate-provider";
import { buildHistoricalFxTransaction, buildHistoricalPoolPreview } from "./historical-pool-attribution";
import type { AttributionCapitalEvent } from "./investor-attribution";

const capitalEvents: AttributionCapitalEvent[] = [
  { participantId: "manager", participantName: "Manager", participantType: "manager", effectiveDate: "2026-01-01", amountPkr: 10_000_000, eventType: "opening" },
  { participantId: "investor", participantName: "Investor", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 30_000_000, eventType: "opening", investorProfitSharePercent: 50 },
];

function manualRate(fromCurrencyCode: string, buyRate: number, sellRate: number, referenceRate: number) {
  return normalizeExchangeRateRow({
    provider: "MANUAL_OPEN_MARKET",
    market: "manual_open_market",
    fromCurrencyCode,
    toCurrencyCode: "PKR",
    buyRate,
    sellRate,
    referenceRate,
    sourceTimestamp: "2026-01-31",
    fetchedTimestamp: "2026-01-31T12:00:00.000Z",
    providerReference: `manual-${fromCurrencyCode}`,
    entryMethod: "manual",
  });
}

test("manual USD AFN and RMB rates normalize without losing provider metadata", () => {
  for (const code of ["USD", "AFN", "RMB"]) {
    const result = selectRateForPosition(manualRate(code, 280, 282, 281), "asset");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.provider, "MANUAL_OPEN_MARKET");
    assert.equal(result.entryMethod, "manual");
    assert.equal(result.fromCurrencyCode, code);
    assert.equal(result.selectedRateType, "buy");
    assert.equal(result.rate, 280);
    assert.equal(result.sourceRates[0].providerReference, `manual-${code}`);
  }
});

test("Sarafi provider response is normalized but remains foundation-only", () => {
  const sourceRate = normalizeSarafiAfRate({
    market: "sarai_shahzada",
    fromCurrencyCode: "USD",
    buyRate: 66,
    sellRate: 66.05,
    sourceTimestamp: "2026-01-31T15:38:00+04:30",
    fetchedTimestamp: "2026-01-31T11:08:00.000Z",
    providerReference: "sarafi-af-usd-afn",
  });
  const status = sarafiAfIntegrationStatus();

  assert.equal(sourceRate.provider, "SARAFI_AF");
  assert.equal(sourceRate.toCurrencyCode, "AFN");
  assert.equal(sourceRate.entryMethod, "api");
  assert.equal(status.authoritative, false);
  assert.equal(status.automaticIngestionEnabled, false);
});

test("provider unavailable returns explicit missing result instead of guessing", () => {
  const missing = selectRateForPosition(
    normalizeExchangeRateRow({
      provider: "MANUAL_OPEN_MARKET",
      fromCurrencyCode: "USD",
      toCurrencyCode: "PKR",
      buyRate: null,
      sellRate: null,
      referenceRate: null,
    }),
    "asset"
  );

  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.missingReason, /Missing USD→PKR buy rate/);
});

test("cross-rate calculation exposes AFN to USD to PKR path", () => {
  const afnUsd = selectRateForPosition(normalizeExchangeRateRow({
    provider: "SARAFI_AF",
    market: "sarai_shahzada",
    fromCurrencyCode: "AFN",
    toCurrencyCode: "USD",
    buyRate: 0.015,
    sellRate: 0.016,
    referenceRate: null,
    entryMethod: "api",
  }), "asset");
  const usdPkr = selectRateForPosition(manualRate("USD", 280, 282, 281), "asset");
  const crossRate = buildCrossRateToPkr({
    fromCurrencyCode: "AFN",
    viaCurrencyCode: "USD",
    firstLeg: afnUsd,
    secondLeg: usdPkr,
    positionKind: "asset",
  });

  assert.equal(crossRate.ok, true);
  if (!crossRate.ok) return;
  assert.deepEqual(crossRate.conversionPath, ["AFN→USD", "USD→PKR"]);
  assert.equal(crossRate.rate, 4.2);
});

test("asset and liability valuations use buy and sell rates respectively", () => {
  const sourceRate = manualRate("USD", 280, 282, 281);
  const asset = selectRateForPosition(sourceRate, "asset");
  const liability = selectRateForPosition(sourceRate, "liability");

  assert.equal(asset.ok && asset.selectedRateType, "buy");
  assert.equal(asset.ok && asset.rate, 280);
  assert.equal(liability.ok && liability.selectedRateType, "sell");
  assert.equal(liability.ok && liability.rate, 282);
});

test("historical provider result is snapshotted and not rewritten by later provider changes", () => {
  const firstProviderResult = selectRateForPosition(manualRate("USD", 280, 282, 281), "asset");
  const laterProviderResult = selectRateForPosition(manualRate("USD", 300, 302, 301), "asset");
  assert.equal(firstProviderResult.ok, true);
  assert.equal(laterProviderResult.ok, true);
  if (!firstProviderResult.ok || !laterProviderResult.ok) return;

  const transaction = buildHistoricalFxTransaction({
    sourceId: "usd-layer-1",
    sourcePosition: "USD layer 1",
    recognizedDate: "2026-01-31",
    originalPoolDate: "2026-01-10",
    currencyCode: "USD",
    foreignAmount: 1_000,
    carryingRate: 270,
    valuationRate: firstProviderResult.rate,
    valuationDate: "2026-01-31",
    provider: firstProviderResult.provider,
    market: firstProviderResult.market,
    selectedRateType: firstProviderResult.selectedRateType,
    positionKind: firstProviderResult.positionKind,
    conversionPath: firstProviderResult.conversionPath,
    sourceRates: firstProviderResult.sourceRates,
  });

  assert.equal(transaction.fx?.valuationRate, 280);
  assert.equal(transaction.fx?.fxGainLossPkr, 10_000);
  assert.equal(laterProviderResult.rate, 300);
  assert.equal(transaction.fx?.valuationRate, 280);
});

test("missing historical rate is visible on FX transaction and blocks preview", () => {
  const transaction = buildHistoricalFxTransaction({
    sourceId: "missing-rate",
    sourcePosition: "RMB payable",
    recognizedDate: "2026-01-31",
    originalPoolDate: "2026-01-10",
    currencyCode: "RMB",
    foreignAmount: 1_000,
    carryingRate: 40,
    valuationRate: null,
    valuationDate: "2026-01-31",
  });
  const preview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    transactions: [transaction],
  });

  assert.equal(transaction.fx?.fxGainLossPkr, null);
  assert.ok(preview.blockedReasons.includes("Missing RMB→PKR valuation rate for RMB payable on 2026-01-31."));
});

test("FX gain/loss reconciles after provider normalization", () => {
  const providerResult = selectRateForPosition(manualRate("USD", 280, 282, 281), "asset");
  assert.equal(providerResult.ok, true);
  if (!providerResult.ok) return;

  const preview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    transactions: [buildHistoricalFxTransaction({
      sourceId: "usd-layer-2",
      sourcePosition: "USD layer 2",
      recognizedDate: "2026-01-31",
      originalPoolDate: "2026-01-10",
      currencyCode: "USD",
      foreignAmount: 1_000,
      carryingRate: 270,
      valuationRate: providerResult.rate,
      valuationDate: "2026-01-31",
      provider: providerResult.provider,
      market: providerResult.market,
      selectedRateType: providerResult.selectedRateType,
      positionKind: providerResult.positionKind,
      conversionPath: providerResult.conversionPath,
      sourceRates: providerResult.sourceRates,
    })],
  });

  const link = preview.transactionLinks[0];
  assert.equal(link.amountPkr, 10_000);
  assert.equal(link.fx?.provider, "MANUAL_OPEN_MARKET");
  assert.equal(link.fx?.selectedRateType, "buy");
  assert.equal(link.reconciliationDifferencePkr, 0);
  assert.equal(preview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});
