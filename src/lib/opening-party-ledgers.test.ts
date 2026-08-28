import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildIntermediaryLedgerEntries, paginateIntermediaryLedger } from "./intermediary-ledger";
import { buildSupplierRunningLedger, buildSupplierStatement } from "./supplier-ledger";

test("supplier opening USD is settled before FIFO lot purchases", () => {
  const supplier = {
    openingLiabilities: [{ id: 7, amount: 100, openingDate: new Date("2025-12-31"), currency: { code: "USD" } }],
    lotPurchases: [{ id: 1, lotId: 10, qty: 1, totalPriceUsd: 200, createdAt: new Date("2026-01-01"), product: { name: "Product" }, lot: { lotNumber: "L-1", lotDate: new Date("2026-01-01"), country: { name: "Pakistan" } } }],
    supplierPayments: [{ id: 2, amountUsd: 150, paymentDate: new Date("2026-01-02"), lotId: null, reference: null }],
  };

  const statement = buildSupplierStatement(supplier);
  assert.equal(statement.openingBalanceUsd, 100);
  assert.equal(statement.openingBalanceRemainingUsd, 0);
  assert.equal(statement.rows[0].depositUsd, 50);
  assert.equal(statement.rows[0].lotBalanceUsd, 150);

  const running = buildSupplierRunningLedger(supplier);
  assert.equal(running[0].sourceType, "opening");
  assert.equal(running.at(-1)?.balanceUsd, 150);
});

test("intermediary opening receivable increases with a later deposit", () => {
  const entries = buildIntermediaryLedgerEntries({
    openingLiabilities: [{ id: 1, amount: 100, openingDate: new Date("2025-12-31"), currency: { code: "USD" } }],
    deposits: [{ id: 2, depositDate: new Date("2026-01-01"), amount: 40, currency: { code: "USD" } }],
    payments: [],
    exchanges: [],
    hajiTransfers: [],
  });

  const result = paginateIntermediaryLedger(entries, 1, 20);
  assert.equal(result.ledger[0].credit, 100);
  assert.equal(result.balances.USD, -140);
});

test("all super-admin party ledgers query their opening liabilities", () => {
  for (const file of [
    "src/app/api/v1/suppliers/[id]/route.ts",
    "src/app/api/v1/shipping-lines/[id]/route.ts",
    "src/app/api/v1/agents/[id]/route.ts",
    "src/app/api/v1/intermediaries/[id]/route.ts",
  ]) {
    assert.match(readFileSync(file, "utf8"), /openingLiabilit/);
  }
});

test("payables report totals are grouped by currency", () => {
  const page = readFileSync("src/app/(dashboard)/accounts/page.tsx", "utf8");
  assert.match(page, /totalsByCurrency/);
  assert.doesNotMatch(page, /USD \{n\(total\)\}/);
});

test("intermediary openings are assets rather than payables", () => {
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const reports = readFileSync("src/app/api/v1/financial-reports/route.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260826090000_journal_opening_customer_receivables/migration.sql", "utf8");

  assert.match(accounting, /p\.liabilityType === "intermediary"/);
  assert.match(accounting, /Opening intermediary receivable/);
  assert.match(migration, /WHEN 'intermediary' THEN TRUE/);
  assert.doesNotMatch(reports, /const intermediaries: any\[\] = \[\]/);
});
