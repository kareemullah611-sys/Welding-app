import test from "node:test";
import assert from "node:assert/strict";
import { finalizeLedgerForDisplay, sortLedgerNewestFirst } from "@/lib/ledger-display";

test("sortLedgerNewestFirst orders by date then createdAt descending", () => {
  const rows = sortLedgerNewestFirst([
    { key: "a", date: "2026-01-01", createdAt: "2026-01-01T10:00:00Z", currencyCode: "PKR", credit: 0, debit: 0 },
    { key: "b", date: "2026-06-01", createdAt: "2026-06-01T10:00:00Z", currencyCode: "PKR", credit: 0, debit: 0 },
    { key: "c", date: "2026-06-01", createdAt: "2026-06-01T12:00:00Z", currencyCode: "PKR", credit: 0, debit: 0 },
  ] as any);

  assert.deepEqual(rows.map((r) => r.key), ["c", "b", "a"]);
});

test("finalizeLedgerForDisplay returns newest-first rows with running balances", () => {
  const { ledger, balanceByCurrency } = finalizeLedgerForDisplay([
    {
      key: "open",
      date: new Date("2026-01-01"),
      createdAt: new Date("2026-01-01T08:00:00Z"),
      type: "Opening",
      detail: "Opening",
      reference: null,
      currencyCode: "PKR",
      credit: 1000,
      debit: 0,
    },
    {
      key: "pay",
      date: new Date("2026-06-01"),
      createdAt: new Date("2026-06-01T10:00:00Z"),
      type: "Payment",
      detail: "Payment",
      reference: null,
      currencyCode: "PKR",
      credit: 500,
      debit: 0,
    },
  ] as any);

  assert.deepEqual(ledger.map((r) => r.key), ["pay", "open"]);
  assert.equal(ledger[0].runningBalance, 1500);
  assert.equal(ledger[1].runningBalance, 1000);
  assert.equal(balanceByCurrency.PKR, 1500);
});
