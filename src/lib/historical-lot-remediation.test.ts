import assert from "node:assert/strict";
import test from "node:test";
import {
  getApprovedHistoricalLotRate,
  HISTORICAL_LOT_REMEDIATION_RATES,
} from "./historical-lot-remediation";

test("historical remediation catalog contains only the approved 16 lots", () => {
  assert.equal(HISTORICAL_LOT_REMEDIATION_RATES.length, 16);
  assert.deepEqual(
    HISTORICAL_LOT_REMEDIATION_RATES.map((row) => row.lotNumber).sort(),
    [
      "032", "108", "109", "124", "194", "195", "225", "242", "260", "649", "865",
      "JBP-013", "JBP-112", "JBP-866", "JBP305-26", "JBP306-26",
    ].sort(),
  );
});

test("documented Pakistan lots preserve SBP selling plus three metadata", () => {
  const result = getApprovedHistoricalLotRate("PK", "649");
  assert.deepEqual(result, {
    countryCode: "PK",
    lotNumber: "649",
    recognitionDate: "2025-10-08",
    rawBuyRate: 281.71,
    rawSellRate: 282.25,
    adjustmentPkr: 3,
    finalRate: 285.25,
    source: "SBP_OPEN_MARKET_CLOSING",
    sourceReference: "SBP open-market closing USD/PKR for 2025-10-08",
  });
});

test("manual historical rates remain exact exceptions and never apply to unrelated lots", () => {
  assert.equal(getApprovedHistoricalLotRate("PK", "195")?.finalRate, 281);
  assert.equal(getApprovedHistoricalLotRate("AF", "JBP-013")?.finalRate, 288);
  assert.equal(getApprovedHistoricalLotRate("PK", "JBP-013"), null);
  assert.equal(getApprovedHistoricalLotRate("PK", "unrelated"), null);
});
