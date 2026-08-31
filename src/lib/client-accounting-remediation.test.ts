import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildLotPurchasePkrBasis,
  lotPurchaseJournalTransactionId,
  personalExpenseJournalTransactionId,
} from "./accounting";
import { buildAuthoritativePoolTransactions } from "./authoritative-pool-transactions";
import { excludeExactlyReversedJournalGroups } from "./accounting-correction-reconciliation";

test("foreign lot purchase posts its immutable PKR carrying basis", () => {
  assert.deepEqual(buildLotPurchasePkrBasis({ totalUsd: 60_000, carryingRatePkr: 283 }), {
    foreignAmountUsd: 60_000,
    carryingRatePkr: 283,
    carryingAmountPkr: 16_980_000,
  });
  assert.throws(
    () => buildLotPurchasePkrBasis({ totalUsd: 60_000, carryingRatePkr: 0 }),
    /PKR recognition rate/i,
  );
});

test("purchase and personal-expense edits use immutable journal versions", () => {
  assert.equal(lotPurchaseJournalTransactionId(4, 9, 1), "PURCH-4-9");
  assert.equal(lotPurchaseJournalTransactionId(4, 9, 2), "PURCH-4-9-V2");
  assert.equal(personalExpenseJournalTransactionId(7, 1), "SAEXP-7");
  assert.equal(personalExpenseJournalTransactionId(7, 3), "SAEXP-7-V3");
});

test("lot purchase routes persist carrying metadata and never swallow journal failures", () => {
  const createRoute = readFileSync("src/app/api/v1/lot-purchases/route.ts", "utf8");
  const editRoute = readFileSync("src/app/api/v1/lot-purchases/[id]/route.ts", "utf8");
  const lotRoute = readFileSync("src/app/api/v1/lots/[id]/route.ts", "utf8");

  assert.match(createRoute, /carryingRatePkr/);
  assert.match(createRoute, /carryingAmountPkr/);
  assert.match(editRoute, /journalVersion:\s*\{\s*increment:\s*1\s*\}/);
  assert.doesNotMatch(editRoute, /catch \(je\).*console\.error/s);
  assert.match(lotRoute, /reverseJournalEntries[\s\S]*lotPurchase\.deleteMany/);
});

test("personal-expense edit increments journal version before reposting", () => {
  const route = readFileSync("src/app/api/v1/super-admin-personal-expenses/[id]/route.ts", "utf8");
  assert.match(route, /journalVersion:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(route, /personalExpenseJournalTransactionId/);
});

test("accounting migration is additive and preserves existing finance rows", () => {
  const migration = readFileSync(
    "prisma/migrations/20260829170000_client_accounting_remediation/migration.sql",
    "utf8",
  );
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(migration, /carrying_rate_pkr/);
  assert.match(migration, /journal_version/);
  assert.match(migration, /line_number/);
});

test("investor readiness shown to users comes from the authoritative dry run", () => {
  const route = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  assert.match(route, /authoritativeReadiness/);
  assert.match(route, /readiness:\s*authoritativeReadiness/);
  assert.match(route, /finalizationDryRun\.blockers/);
});

test("historical pool input equals authoritative PKR P&L lines", () => {
  const transactions = buildAuthoritativePoolTransactions({
    journalLines: [
      { id: 1, transactionId: "SALE-1", entryDate: "2026-06-01", currencyCode: "PKR", debit: 0, credit: 1_000, description: "Sale", account: { code: "SALES", accountType: "revenue" } },
      { id: 2, transactionId: "COGS-1", entryDate: "2026-06-01", currencyCode: "PKR", debit: 800, credit: 0, description: "COGS", account: { code: "COGS", accountType: "cogs" } },
      { id: 3, transactionId: "EXP-1", entryDate: "2026-06-02", currencyCode: "PKR", debit: 25, credit: 0, description: "Expense", account: { code: "EXP", accountType: "expense" } },
      { id: 4, transactionId: "FX-1", entryDate: "2026-06-03", currencyCode: "PKR", debit: 0, credit: 10, description: "FX gain", account: { code: "FX-GAIN", accountType: "revenue" } },
      { id: 5, transactionId: "RAW-AFN", entryDate: "2026-06-03", currencyCode: "AFN", debit: 0, credit: 99_999, description: "Raw AFN", account: { code: "SALES", accountType: "revenue" } },
    ],
    recognizedForeignSales: [
      { id: 2, saleDate: "2026-06-04", voucherNo: "AF-2", fxPkrEquivalent: 200, customerName: "Customer" },
    ],
    originalPoolDateByTransactionId: new Map([["FX-1", "2026-05-15"]]),
  });

  assert.equal(transactions.reduce((sum, transaction) => sum + transaction.amountPkr, 0), 385);
  assert.equal(transactions.find((transaction) => transaction.sourceId === "journal:4")?.originalPoolDate, "2026-05-15");
  assert.equal(transactions.some((transaction) => transaction.sourceId === "journal:5"), false);
});

test("client correction tooling is preview-only and covers known defect classes", () => {
  const script = readFileSync("scripts/client-accounting-remediation-preview.ts", "utf8");
  assert.match(script, /READ_ONLY_PREVIEW/);
  assert.match(script, /purchase_basis_correction/);
  assert.match(script, /orphan_purchase_journal/);
  assert.match(script, /supplier_settlement_correction/);
  assert.match(script, /duplicate_personal_expense_correction/);
  assert.match(script, /proposedSourceUpdate/);
  assert.match(script, /recognitionRateMetadata/);
  assert.match(script, /realizedFxPkr/);
  assert.match(script, /existingCorrectionTransactionIds/);
  assert.doesNotMatch(script, /\.(create|update|delete|createMany|updateMany|deleteMany|upsert)\(/);
  assert.doesNotMatch(script, /\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
});

test("controlled correction runner requires an exact local clone backup and approved preview", () => {
  const script = readFileSync("scripts/apply-client-accounting-corrections.ts", "utf8");
  assert.match(script, /ISOLATED_LOCAL_CLONE/);
  assert.match(script, /acknowledge-database/);
  assert.match(script, /SELECT current_database\(\) AS database/);
  assert.match(script, /Connected database mismatch/);
  assert.match(script, /allow-production-write/);
  assert.match(script, /acknowledge-production/);
  assert.match(script, /acknowledge-host/);
  assert.match(script, /preview-sha256/);
  assert.match(script, /backup-sha256/);
  assert.match(script, /expected-count/);
  assert.match(script, /Serializable/);
  assert.match(script, /timeout:\s*600_000/);
  assert.match(script, /pg_advisory_xact_lock/);
  assert.match(script, /CORRECTION_ALREADY_EXISTS/);
  assert.match(script, /proposedSourceUpdate/);
});

test("financial-year controls are additive and enforced at journal boundaries", () => {
  const migration = readFileSync("prisma/migrations/20260829180000_financial_year_controls/migration.sql", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const route = readFileSync("src/app/api/v1/financial-years/[id]/route.ts", "utf8");
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(migration, /financial_years/);
  assert.match(accounting, /assertAccountingDateOpen/);
  assert.match(accounting, /Accounting period .* is closed/);
  assert.match(route, /super_admin/);
  assert.match(route, /auditLog\.create/);
});

test("cutover readiness is a read-only accounting-equation preview", () => {
  const script = readFileSync("scripts/client-cutover-readiness.ts", "utf8");
  assert.match(script, /ASSETS_MINUS_LIABILITIES_EQUITY_EARNINGS/);
  assert.match(script, /correctionPreview/);
  assert.match(script, /unbalancedJournalGroups/);
  assert.doesNotMatch(script, /\.(create|update|delete|createMany|updateMany|deleteMany|upsert)\(/);
  assert.doesNotMatch(script, /\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
});

test("cutover reconciliation excludes only exact legacy reversal pairs", () => {
  const lines = [
    { transactionId: "SUPPPAY-1", accountId: 2, currencyCode: "USD", debit: 25_000, credit: 0 },
    { transactionId: "SUPPPAY-1", accountId: 21, currencyCode: "PKR", debit: 0, credit: 7_005_000 },
    { transactionId: "CORR-REV-SUPPPAY-1", accountId: 2, currencyCode: "USD", debit: 0, credit: 25_000 },
    { transactionId: "CORR-REV-SUPPPAY-1", accountId: 21, currencyCode: "PKR", debit: 7_005_000, credit: 0 },
    { transactionId: "CORR-SUPPPAY-1", accountId: 2, currencyCode: "PKR", debit: 7_131_250, credit: 0 },
    { transactionId: "CORR-SUPPPAY-1", accountId: 21, currencyCode: "PKR", debit: 0, credit: 7_005_000 },
    { transactionId: "CORR-SUPPPAY-1", accountId: 99, currencyCode: "PKR", debit: 0, credit: 126_250 },
  ];
  const result = excludeExactlyReversedJournalGroups(lines);
  assert.deepEqual(result.exactReversalPairs, [{ originalTransactionId: "SUPPPAY-1", reversalTransactionId: "CORR-REV-SUPPPAY-1" }]);
  assert.equal(result.effectiveJournalLines.length, 3);
  assert.equal(result.unmatchedReversalTransactionIds.length, 0);
});

test("historical remediation removes a prior partial edit reversal before correcting the active purchase", () => {
  const lines = [
    { transactionId: "PURCH-4-2", accountId: 1, currencyCode: "USD", debit: 5_700, credit: 0 },
    { transactionId: "PURCH-4-2", accountId: 2, currencyCode: "USD", debit: 0, credit: 5_700 },
    { transactionId: "PURCH-4-2", accountId: 1, currencyCode: "USD", debit: 5_700, credit: 0 },
    { transactionId: "PURCH-4-2", accountId: 2, currencyCode: "USD", debit: 0, credit: 5_700 },
    { transactionId: "REV-PURCH-4-2", accountId: 1, currencyCode: "USD", debit: 0, credit: 5_700 },
    { transactionId: "REV-PURCH-4-2", accountId: 2, currencyCode: "USD", debit: 5_700, credit: 0 },
  ];
  const result = excludeExactlyReversedJournalGroups(lines);
  assert.equal(result.effectiveJournalLines.length, 2);
  assert.ok(result.effectiveJournalLines.every((line) => line.transactionId === "PURCH-4-2"));
  assert.equal(result.unmatchedReversalTransactionIds.length, 0);
});
