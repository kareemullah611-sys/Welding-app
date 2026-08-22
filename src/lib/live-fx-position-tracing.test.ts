import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveFxCoveragePreview,
  type ReliableLiveFxPosition,
  type UnsupportedLiveFxPosition,
} from "./live-fx-position-tracing";
import {
  normalizeExchangeRateRow,
  selectRateForPosition,
  type NormalizedExchangeRateResult,
} from "./exchange-rate-provider";

function rate(currencyCode: string, kind: "asset" | "liability"): NormalizedExchangeRateResult {
  return selectRateForPosition(normalizeExchangeRateRow({
    provider: "MANUAL_OPEN_MARKET",
    market: "open_market",
    fromCurrencyCode: currencyCode,
    toCurrencyCode: "PKR",
    buyRate: 280,
    sellRate: 282,
    referenceRate: 281,
    providerReference: `manual:${currencyCode}`,
  }), kind);
}

function position(input: Partial<ReliableLiveFxPosition> & { currencyCode: string; positionKind: "asset" | "liability" }): ReliableLiveFxPosition {
  return {
    sourceRecord: input.sourceRecord || `${input.currencyCode.toLowerCase()}:1`,
    sourcePosition: input.sourcePosition || `${input.currencyCode} live position`,
    positionType: input.positionType || "intermediary_balance",
    positionKind: input.positionKind,
    currencyCode: input.currencyCode,
    foreignAmount: input.foreignAmount ?? 1_000,
    carryingPkrValue: input.carryingPkrValue ?? 270_000,
    historicalRate: input.historicalRate ?? 270,
    historicalPoolDate: input.historicalPoolDate || "2026-01-10",
    valuationDate: input.valuationDate || "2026-01-31",
    valuationRate: input.valuationRate || rate(input.currencyCode, input.positionKind),
  };
}

test("live FX coverage traces AFN asset and liability using buy and sell rates", () => {
  const preview = buildLiveFxCoveragePreview({
    supportedPositions: [
      position({ currencyCode: "AFN", positionKind: "asset", sourceRecord: "cash:afn" }),
      position({ currencyCode: "AFN", positionKind: "liability", sourceRecord: "payable:afn" }),
    ],
  });

  assert.equal(preview.supportedPositions[0].selectedRateType, "buy");
  assert.equal(preview.supportedPositions[0].valuationRate, 280);
  assert.equal(preview.supportedPositions[1].selectedRateType, "sell");
  assert.equal(preview.supportedPositions[1].valuationRate, 282);
});

test("live FX coverage traces RMB asset and liability using reliable source records", () => {
  const preview = buildLiveFxCoveragePreview({
    supportedPositions: [
      position({ currencyCode: "RMB", positionKind: "asset", sourceRecord: "intermediary:rmb" }),
      position({ currencyCode: "RMB", positionKind: "liability", sourceRecord: "shipper:rmb" }),
    ],
  });

  assert.equal(preview.supportedPositions.length, 2);
  assert.equal(preview.supportedPositions[0].currencyCode, "RMB");
  assert.equal(preview.historicalTransactions.every((tx) => tx.sourceType === "fx_gain_loss"), true);
});

test("live FX coverage keeps existing USD path supported", () => {
  const preview = buildLiveFxCoveragePreview({
    supportedPositions: [position({ currencyCode: "USD", positionKind: "asset", sourceRecord: "intermediary_usd_cost_layers:1" })],
  });

  assert.equal(preview.supportedPositions[0].sourceRecord, "intermediary_usd_cost_layers:1");
  assert.equal(preview.unsupportedPositions.length, 0);
});

test("live FX coverage blocks missing source balance instead of inventing one", () => {
  const unsupported: UnsupportedLiveFxPosition = {
    sourceRecord: "intermediary_deposits:9",
    sourcePosition: "intermediary_deposit:9",
    positionType: "intermediary_balance",
    positionKind: "asset",
    currencyCode: "AFN",
    foreignAmount: 50_000,
    date: "2026-01-20",
    reason: "No source-layer remaining balance table exists for AFN.",
  };
  const preview = buildLiveFxCoveragePreview({ supportedPositions: [], unsupportedPositions: [unsupported] });

  assert.equal(preview.unsupportedPositions[0].currencyCode, "AFN");
  assert.match(preview.unsupportedPositions[0].reason, /No source-layer remaining balance/);
  assert.equal(preview.coverageSummary.find((row) => row.path === "intermediary_balance")?.status, "BLOCKED");
});

test("live FX coverage exposes missing historical and valuation rates", () => {
  const missingRate: NormalizedExchangeRateResult = {
    ok: false,
    provider: "MANUAL_OPEN_MARKET",
    market: "open_market",
    fromCurrencyCode: "RMB",
    toCurrencyCode: "PKR",
    positionKind: "asset",
    missingReason: "Missing RMB→PKR open-market rate for asset valuation on 2026-01-31.",
    conversionPath: ["RMB→PKR"],
    sourceRates: [],
  };
  const preview = buildLiveFxCoveragePreview({
    supportedPositions: [position({ currencyCode: "RMB", positionKind: "asset", historicalRate: 0, valuationRate: missingRate })],
  });

  assert.equal(preview.historicalTransactions[0].fx?.carryingRate, 0);
  assert.match(preview.historicalTransactions[0].fx?.missingRateReason || "", /Missing RMB→PKR valuation rate/);
});
