import assert from "node:assert/strict";
import test from "node:test";

import { journalSaleCOGSForLots } from "@/lib/accounting";

test("a multi-lot sale posts one balanced COGS journal with per-lot attribution", async () => {
  const writes: any[][] = [];
  const db = {
    sale: { findUnique: async () => ({ isOpeningImport: false }) },
    lot: { findUnique: async () => ({ pkrExchangeRate: 280, countryId: 1, lotDate: new Date("2026-01-01") }) },
    lotCost: { findMany: async () => [] },
    lotProduct: { findMany: async () => [] },
    saleItem: {
      findMany: async ({ where }: any) => [{ productId: where.lotId, qty: 2, product: { unitOfMeasure: "CTN" } }],
    },
    openingInventoryValuation: {
      findMany: async ({ where }: any) => [{ productId: where.lotId, unitCostPkr: where.lotId === 10 ? 50 : 75 }],
    },
    account: {
      upsert: async ({ where }: any) => ({ id: where.code === "4001" ? 1 : 2 }),
    },
    journalEntry: {
      findMany: async () => [],
      createMany: async ({ data }: any) => { writes.push(data); },
    },
  };

  await journalSaleCOGSForLots({
    saleId: 99,
    allocations: [
      { lotId: 10, totalQtySold: 2 },
      { lotId: 20, totalQtySold: 2 },
    ],
    saleDate: new Date("2026-09-11"),
    cityId: 3,
    createdBy: 7,
  }, db as any);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 4);
  assert.deepEqual(writes[0].map((row) => row.lotId), [10, 10, 20, 20]);
  assert.ok(writes[0].every((row) => row.transactionId === "COGS-99"));
  assert.equal(writes[0].reduce((sum, row) => sum + Number(row.debit), 0), 250);
  assert.equal(writes[0].reduce((sum, row) => sum + Number(row.credit), 0), 250);
});
