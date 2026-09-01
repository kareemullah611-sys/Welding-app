import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyOpeningByCurrency, computeAvailableStockWithOpening } from "@/lib/opening-calculations";

test("applyOpeningByCurrency adds opening amounts to existing currency totals", () => {
  const base = { PKR: 120000, AFN: 50000 };
  const opening = { PKR: 30000, USD: 250 };
  const merged = applyOpeningByCurrency(base, opening);

  assert.deepEqual(merged, {
    PKR: 150000,
    AFN: 50000,
    USD: 250,
  });
});

test("computeAvailableStockWithOpening includes opening stock", () => {
  const available = computeAvailableStockWithOpening({
    openingQty: 20,
    receivedQty: 50,
    soldQty: 40,
    transferredOutQty: 5,
    transferredInQty: 0,
  });

  assert.equal(available, 25);
});

test("lot godown stock cannot exceed assigned city distribution", () => {
  const source = readFileSync("src/lib/lot-godown-stock.ts", "utf8");
  const legacyEndpoint = readFileSync("src/app/api/v1/lots/[id]/godown-allocate/route.ts", "utf8");

  assert.match(source, /No distribution found for this lot\/city\/product combination/);
  assert.match(source, /nextCityTotal > Number\(dist\.allocatedQty\)/);
  assert.doesNotMatch(source, /data: \{ allocatedQty: cityTotal \}/);
  assert.doesNotMatch(source, /lotProduct\.upsert/);
  assert.match(legacyEndpoint, /incomingByGodown/);
  assert.match(legacyEndpoint, /nextTotal > Number\(lockedDist\.allocatedQty\)/);
});
