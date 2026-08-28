import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyCustomerBalance } from "./customer-receivable-accounting";
import { applyPendingReceivablesReport } from "./offline-financial-ledgers";

test("positive customer balances remain receivables and credit balances become advances", () => {
  assert.deepEqual(classifyCustomerBalance(1250), { receivable: 1250, advance: 0, net: 1250 });
  assert.deepEqual(classifyCustomerBalance(-300), { receivable: 0, advance: 300, net: -300 });
  assert.deepEqual(classifyCustomerBalance(0), { receivable: 0, advance: 0, net: 0 });
});

test("opening customer create, edit, and delete maintain the journal atomically", () => {
  const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");

  assert.match(route, /journalOpeningCustomerBalance/);
  assert.match(route, /reverseOpeningCustomerBalanceJournals\(saved\.id/);
  assert.match(route, /reverseOpeningCustomerBalanceJournals\(row\.id/);
  assert.match(route, /journalVersion:\s*previousVersions \+ 1/);
  assert.match(route, /prisma\.\$transaction/);
});

test("existing customer openings receive an idempotent deployment backfill", () => {
  const migration = readFileSync(
    "prisma/migrations/20260826090000_journal_opening_customer_receivables/migration.sql",
    "utf8",
  );

  assert.match(migration, /OPENAR-' \|\| o\."id" \|\| '-V1/);
  assert.match(migration, /opening_customer_balances/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /Opening Balances/);
});

test("financial reports separate receivables from customer advances", () => {
  const route = readFileSync("src/app/api/v1/financial-reports/route.ts", "utf8");

  assert.match(route, /customerAdvances/);
  assert.match(route, /customerAdvancesByCurrency/);
  assert.match(route, /netPositionByCurrency/);
  assert.match(route, /Customer Advance -/);
});

test("offline payments move an overpaid customer from receivables to advances", () => {
  const report = applyPendingReceivablesReport(
    {
      totalByCurrency: { PKR: 100 },
      netPositionByCurrency: { PKR: 100 },
      customers: [{ account: "AR - Test Customer (Pending)", currency: "PKR", balance: 100 }],
      customerAdvances: [],
    },
    [{ url: "/api/v1/payments", method: "POST", body: JSON.stringify({ customerName: "Test Customer", currencyCode: "PKR", amount: 150 }) }],
  );

  assert.deepEqual(report?.customers, []);
  assert.deepEqual(report?.customerAdvances, [{ account: "AR - Test Customer (Pending)", currency: "PKR", balance: 50 }]);
  assert.equal(report?.totalByCurrency?.PKR, 0);
  assert.equal(report?.customerAdvancesByCurrency?.PKR, 50);
  assert.equal(report?.netPositionByCurrency?.PKR, -50);
});
