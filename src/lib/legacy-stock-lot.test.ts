import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_LOT_NUMBER, LEGACY_LOT_DATE } from "./legacy-stock-lot";

describe("legacy-stock-lot constants", () => {
  it("uses one OLD-STOCK lot number per country", () => {
    assert.equal(LEGACY_LOT_NUMBER, "OLD-STOCK");
  });

  it("uses an early lot date so FIFO consumes legacy stock first", () => {
    assert.equal(LEGACY_LOT_DATE.toISOString().slice(0, 10), "2000-01-01");
  });
});
