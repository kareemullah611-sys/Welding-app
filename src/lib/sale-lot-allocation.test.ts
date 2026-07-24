import test from "node:test";
import assert from "node:assert/strict";
import { allocateSaleItemAcrossLots } from "@/lib/sale-lot-allocation";

test("allocateSaleItemAcrossLots splits auto sale quantity across oldest available lots", () => {
  const result = allocateSaleItemAcrossLots({
    item: {
      productId: 1,
      lotId: null,
      stockQty: 100,
      cartonQty: null,
      ratePerCarton: 1200,
      ratePerPieceLocal: null,
      ratePerPieceUsd: null,
    },
    availableLots: [
      { lotId: 10, lotNumber: "A", available: 90 },
      { lotId: 11, lotNumber: "B", available: 40 },
    ],
    roundMoney: (value) => Math.round(value * 100) / 100,
  });

  assert.deepEqual(
    result.map((item) => ({ lotId: item.lotId, stockQty: item.stockQty, amount: item.amount })),
    [
      { lotId: 10, stockQty: 90, amount: 108000 },
      { lotId: 11, stockQty: 10, amount: 12000 },
    ],
  );
});

test("allocateSaleItemAcrossLots rejects auto sale quantity when lots cannot cover it", () => {
  assert.throws(
    () => allocateSaleItemAcrossLots({
      item: {
        productId: 1,
        lotId: null,
        stockQty: 100,
        cartonQty: null,
        ratePerCarton: 1200,
        ratePerPieceLocal: null,
        ratePerPieceUsd: null,
      },
      availableLots: [{ lotId: 10, lotNumber: "A", available: 90 }],
      roundMoney: (value) => Math.round(value * 100) / 100,
    }),
    /Lot allocation could not cover 10/,
  );
});

test("allocateSaleItemAcrossLots uses selected lot first then oldest lots for remainder", () => {
  const result = allocateSaleItemAcrossLots({
    item: {
      productId: 1,
      lotId: 11,
      stockQty: 100,
      cartonQty: null,
      ratePerCarton: 1200,
      ratePerPieceLocal: null,
      ratePerPieceUsd: null,
    },
    availableLots: [
      { lotId: 10, lotNumber: "Oldest", available: 90 },
      { lotId: 11, lotNumber: "Selected", available: 40 },
      { lotId: 12, lotNumber: "Next", available: 90 },
    ],
    roundMoney: (value) => Math.round(value * 100) / 100,
  });

  assert.deepEqual(
    result.map((item) => ({ lotId: item.lotId, stockQty: item.stockQty, amount: item.amount })),
    [
      { lotId: 11, stockQty: 40, amount: 48000 },
      { lotId: 10, stockQty: 60, amount: 72000 },
    ],
  );
});
