import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSuperAdminBankJournalRows } from "./superadmin-bank-ledger";

test("superadmin bank journal fallback maps asset debits to money in and credits to money out", () => {
  const rows = buildSuperAdminBankJournalRows([
    {
      id: 11,
      transactionId: "PAY-44",
      debit: 1000,
      credit: 0,
      currencyCode: "PKR",
      description: "Customer receipt",
      entryDate: new Date("2026-09-29"),
      createdAt: new Date("2026-09-29T10:00:00Z"),
    },
    {
      id: 12,
      transactionId: "SUPPAY-8",
      debit: 0,
      credit: 250,
      currencyCode: "PKR",
      description: "Supplier payment",
      entryDate: new Date("2026-09-30"),
      createdAt: new Date("2026-09-30T10:00:00Z"),
    },
  ]);

  assert.deepEqual(rows.map(({ credit, debit, reference }) => ({ credit, debit, reference })), [
    { credit: 1000, debit: 0, reference: "PAY-44" },
    { credit: 0, debit: 250, reference: "SUPPAY-8" },
  ]);
});

test("superadmin bank API falls back to its authoritative GL only when operational rows are empty", () => {
  const route = readFileSync("src/app/api/v1/bank-accounts/[id]/route.ts", "utf8");

  assert.match(route, /appendSuperAdminJournalFallbackRows\(id, account\.accountKind, rows\)/);
  assert.match(route, /if \(rows\.length > 0\) return/);
  assert.match(route, /`1050-SABANK\$\{accountId\}`/);
  assert.match(route, /`1051-SACASH\$\{accountId\}`/);
  assert.match(route, /prisma\.journalEntry\.findMany/);
});
