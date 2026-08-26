import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PAKISTAN_USD_OPEN_MARKET_ADJUSTMENT_PKR,
  resolveHistoricalLotRemediationRate,
  resolvePakistanUsdLotRecognitionRate,
} from "./lot-recognition-fx";

test("Pakistan lot recognition uses SBP open-market selling plus the centralized adjustment", () => {
  const result = resolvePakistanUsdLotRecognitionRate({
    transactionDate: "2026-08-14",
    rates: [{
      rateDate: "2026-08-14",
      buyRate: 280,
      sellRate: 281,
      providerReference: "sbp:2026-08-14",
    }],
  });

  assert.equal(PAKISTAN_USD_OPEN_MARKET_ADJUSTMENT_PKR, 3);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.rawSellRate, 281);
  assert.equal(result.ok && result.businessAdjustmentPkr, 3);
  assert.equal(result.ok && result.rate, 284);
  assert.equal(result.ok && result.selectedRateType, "sell");
});

test("Pakistan lot recognition carries the latest previous published rate backward but never uses a future rate", () => {
  const result = resolvePakistanUsdLotRecognitionRate({
    transactionDate: "2026-08-16",
    rates: [
      { rateDate: "2026-08-17", buyRate: 290, sellRate: 291, providerReference: "future" },
      { rateDate: "2026-08-14", buyRate: 280, sellRate: 281, providerReference: "previous" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.rate, 284);
  assert.equal(result.ok && result.rateSourceDate, "2026-08-14");
  assert.equal(result.ok && result.daysCarriedBackward, 2);
});

test("qualifying actual documented initial rate overrides Pakistan market fallback without adding three", () => {
  const result = resolvePakistanUsdLotRecognitionRate({
    transactionDate: "2026-08-14",
    actualDocumentedRate: { rate: 286.5, reference: "supplier-payment-1" },
    rates: [{ rateDate: "2026-08-14", buyRate: 280, sellRate: 281, providerReference: "sbp" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.provider, "ACTUAL_DOCUMENTED_TRANSACTION_RATE");
  assert.equal(result.ok && result.rate, 286.5);
  assert.equal(result.ok && result.businessAdjustmentPkr, 0);
});

test("manual historical remediation rates apply only to the approved exact lot sets", () => {
  assert.deepEqual(resolveHistoricalLotRemediationRate({ countryCode: "PK", lotNumber: "195" }), {
    rate: 281,
    source: "MANUAL_HISTORICAL_REMEDIATION",
  });
  assert.deepEqual(resolveHistoricalLotRemediationRate({ countryCode: "AF", lotNumber: "JBP-112" }), {
    rate: 288,
    source: "MANUAL_HISTORICAL_REMEDIATION",
  });
  assert.equal(resolveHistoricalLotRemediationRate({ countryCode: "PK", lotNumber: "unrelated" }), null);
  assert.equal(resolveHistoricalLotRemediationRate({ countryCode: "AF", lotNumber: "unrelated" }), null);
});

test("future lot recognition is snapshotted with auditable metadata", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const route = readFileSync("src/app/api/v1/lots/route.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260825120000_lot_recognition_rate_metadata/migration.sql", "utf8");

  assert.match(schema, /pkrExchangeRateMetadata\s+Json\?/);
  assert.match(route, /resolveLotRecognitionRateFromDb/);
  assert.match(route, /pkrExchangeRateMetadata:/);
  assert.match(route, /pkrExchangeRate:/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i);
});

test("manual historical lot rate correction requires reason confirmation audit and finalization guard", () => {
  const route = readFileSync("src/app/api/v1/lots/[id]/pkr-rate/route.ts", "utf8");
  assert.match(route, /reason/);
  assert.match(route, /UPDATE HISTORICAL RATE/);
  assert.match(route, /profitAttributionPeriod/);
  assert.match(route, /createAuditLog/);
  assert.match(route, /pkrExchangeRateMetadata/);
});
