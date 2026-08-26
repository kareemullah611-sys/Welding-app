import assert from "node:assert/strict";
import test from "node:test";

import { createJournalEntries, reverseJournalEntries } from "@/lib/accounting";
import { buildDateRange, buildYearDateRange } from "@/lib/date-range";

test("journal creation rejects an unbalanced entry set before writing rows", async () => {
  let writes = 0;
  const db = {
    journalEntry: {
      createMany: async () => { writes += 1; },
    },
  };

  await assert.rejects(
    createJournalEntries("UNBALANCED-1", [
      { accountId: 1, debit: 100, credit: 0, description: "Debit" },
      { accountId: 2, debit: 0, credit: 99.98, description: "Credit" },
    ], {
      currencyCode: "PKR",
      entityType: "test",
      entityId: 1,
      entryDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: 1,
    }, db as any),
    /unbalanced/i,
  );
  assert.equal(writes, 0);
});

test("journal creation uses decimal-safe equality for balanced fractional rows", async () => {
  let writes = 0;
  const db = {
    journalEntry: {
      createMany: async () => { writes += 1; },
    },
  };

  await createJournalEntries("BALANCED-1", [
    { accountId: 1, debit: 0.1, credit: 0, description: "Debit A" },
    { accountId: 2, debit: 0.2, credit: 0, description: "Debit B" },
    { accountId: 3, debit: 0, credit: 0.3, description: "Credit" },
  ], {
    currencyCode: "PKR",
    entityType: "test",
    entityId: 1,
    entryDate: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: 1,
  }, db as any);
  assert.equal(writes, 1);
});

test("journal reversal is idempotent and concurrent attempts create one reversal set", async () => {
  const rows: Array<{ transactionId: string; accountId: number; debit: number; credit: number; [key: string]: any }> = [
    { transactionId: "SALE-9", accountId: 1, debit: 100, credit: 0, currencyCode: "PKR", exchangeRate: null, description: "Sale", entityType: "sale", entityId: 9, lotId: 1, cityId: 1, entryDate: new Date("2026-01-01"), createdBy: 1 },
    { transactionId: "SALE-9", accountId: 2, debit: 0, credit: 100, currencyCode: "PKR", exchangeRate: null, description: "Sale", entityType: "sale", entityId: 9, lotId: 1, cityId: 1, entryDate: new Date("2026-01-01"), createdBy: 1 },
  ];
  let lock = Promise.resolve();
  const tx = {
    $executeRawUnsafe: async () => undefined,
    journalEntry: {
      findMany: async ({ where }: any) => rows.filter((row) => row.transactionId === where.transactionId),
      createMany: async ({ data }: any) => { rows.push(...data); },
    },
  };
  const db = {
    $transaction: async (callback: (client: any) => Promise<void>) => {
      const prior = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => { release = resolve; });
      await prior;
      try { return await callback(tx); } finally { release(); }
    },
  };

  await Promise.all([
    reverseJournalEntries("SALE-9", 1, db as any),
    reverseJournalEntries("SALE-9", 1, db as any),
  ]);

  assert.equal(rows.filter((row) => row.transactionId === "REV-SALE-9").length, 2);
});

test("date ranges include the selected Pakistan and Afghanistan calendar day via exclusive next-day bound", () => {
  const pakistan = buildDateRange("2026-12-31", "2026-12-31");
  const afghanistan = buildDateRange("2026-12-31", "2026-12-31");
  assert.equal(pakistan.gte?.toISOString(), "2026-12-31T00:00:00.000Z");
  assert.equal(pakistan.lt?.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.deepEqual(afghanistan, pakistan);
});

test("date ranges handle month end, leap day, and year end", () => {
  assert.equal(buildDateRange(null, "2026-01-31").lt?.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(buildDateRange(null, "2028-02-29").lt?.toISOString(), "2028-03-01T00:00:00.000Z");
  assert.deepEqual(
    Object.fromEntries(Object.entries(buildYearDateRange(2026)).map(([key, value]) => [key, value.toISOString()])),
    { gte: "2026-01-01T00:00:00.000Z", lt: "2027-01-01T00:00:00.000Z" },
  );
});
