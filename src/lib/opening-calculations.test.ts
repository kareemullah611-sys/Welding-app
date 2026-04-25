import assert from "node:assert/strict";
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
