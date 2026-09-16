import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("intermediary operational balance includes agent settlements", () => {
  const source = read("src/lib/intermediary-balance.ts");

  assert.match(source, /db\.agentPayment\.findMany/);
  assert.match(source, /excludeAgentPaymentId/);
  assert.match(source, /balances\[code\].*agentPayments/s);
});

test("intermediary deposit corrections are atomic and support bank or cash", () => {
  const route = read("src/app/api/v1/intermediary-deposits/[id]/route.ts");

  assert.match(route, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(route, /reverseJournalEntries\(intermediaryDepositJournalTransactionId\(id, locked\.journalVersion\), user\.userId, tx\)/);
  assert.match(route, /superAdminCashAccountId/);
  assert.match(route, /createAuditLog/);
});

test("intermediary returns support superadmin bank or cash with audited reversal", () => {
  const schema = read("prisma/schema.prisma");
  const createRoute = read("src/app/api/v1/haji-cash-receipts/route.ts");
  const reverseRoute = read("src/app/api/v1/haji-cash-receipts/[id]/reverse/route.ts");
  const accountPage = read("src/app/(dashboard)/settings/bank-accounts/page.tsx");

  assert.match(schema, /model HajiCashReceipt[\s\S]*reversedAt/);
  assert.match(createRoute, /superAdminBankAccountId/);
  assert.match(createRoute, /Choose exactly one destination/);
  assert.match(reverseRoute, /reverseJournalEntries/);
  assert.match(reverseRoute, /createAuditLog/);
  assert.match(accountPage, /superAdminBankAccountId/);
});

test("supplier shipping and agent settlements share approved superadmin sources", () => {
  const schema = read("prisma/schema.prisma");
  const accounting = read("src/lib/accounting.ts");
  const shippingRoute = read("src/app/api/v1/shipping-line-payments/route.ts");
  const agentRoute = read("src/app/api/v1/agent-payments/route.ts");

  assert.match(schema, /model ShippingLinePayment[\s\S]*superAdminBankAccountId/);
  assert.match(schema, /model AgentPayment[\s\S]*superAdminBankAccountId/);
  assert.match(accounting, /journalShippingLinePayment[\s\S]*superAdminBankAccountId/);
  assert.match(accounting, /journalAgentPaid[\s\S]*superAdminBankAccountId/);
  assert.match(shippingRoute, /superAdminBankAccountId/);
  assert.match(agentRoute, /superAdminBankAccountId/);
});

test("superadmin bank ledger includes shipping and agent payments deducted from its balance", () => {
  const bankLedger = read("src/app/api/v1/bank-accounts/[id]/route.ts");
  const cashBranchStart = bankLedger.indexOf("const accountLabel = formatSuperAdminBankLabel(account);");
  const bankBranchStart = bankLedger.indexOf("const accountLabel = formatSuperAdminBankLabel(account);", cashBranchStart + 1);
  const bankBranchEnd = bankLedger.indexOf("const account = await prisma.bankAccount.findUnique", bankBranchStart);
  const bankBranch = bankLedger.slice(bankBranchStart, bankBranchEnd);

  assert.match(bankBranch, /prisma\.shippingLinePayment\.findMany/);
  assert.match(bankBranch, /where: \{ superAdminBankAccountId: id, deletedAt: null \}/);
  assert.match(bankBranch, /type: "Send — Shipping Line"/);
  assert.match(bankBranch, /prisma\.agentPayment\.findMany/);
  assert.match(bankBranch, /type: p\.agent\.agentType === "customs" \? "Send — Customs Agent" : "Send — Clearing Agent"/);
});

test("superadmin treasury supports controlled account transfers", () => {
  const schema = read("prisma/schema.prisma");
  const route = read("src/app/api/v1/super-admin-account-transfers/route.ts");

  assert.match(schema, /model SuperAdminAccountTransfer/);
  assert.match(route, /withSuperAdmin/);
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /exchangeRate/);
  assert.match(route, /journalSuperAdminAccountTransfer/);
});

test("superadmin liabilities support principal-only lender ledgers", () => {
  const schema = read("prisma/schema.prisma");
  const route = read("src/app/api/v1/super-admin-liabilities/route.ts");

  assert.match(schema, /model SuperAdminLiabilityAccount/);
  assert.match(schema, /model SuperAdminLiabilityEntry/);
  assert.match(schema, /loan_received/);
  assert.doesNotMatch(schema, /loanInterest|interestRate|interestAccrual/i);
  assert.match(route, /withSuperAdmin/);
});

test("treasury migration is additive and non-destructive", () => {
  const migration = read("prisma/migrations/20260905120000_superadmin_treasury_liabilities/migration.sql");

  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  assert.match(migration, /CREATE TABLE "super_admin_liability_accounts"/);
  assert.match(migration, /CREATE TABLE "super_admin_liability_entries"/);
  assert.match(migration, /CREATE TABLE "super_admin_account_transfers"/);
});

test("city treasury views include permitted liability settlements", () => {
  const treasury = read("src/app/api/v1/treasury/route.ts");
  const cashLedger = read("src/app/api/v1/treasury/cash-ledger/route.ts");
  const bankLedger = read("src/app/api/v1/bank-accounts/[id]/route.ts");

  assert.match(treasury, /superAdminLiabilityEntry/);
  assert.match(treasury, /sourceType: "city_cash"/);
  assert.match(cashLedger, /superAdminLiabilityEntry\.findMany/);
  assert.match(bankLedger, /superAdminLiabilityEntry\.findMany/);
});

test("superadmin can operate principal-only liabilities and account transfers from the UI", () => {
  const sidebar = read("src/components/layout/Sidebar.tsx");
  const liabilityPage = read("src/app/(dashboard)/super-admin-liabilities/page.tsx");
  const transferPage = read("src/app/(dashboard)/super-admin-account-transfers/page.tsx");
  const optionsRoute = read("src/app/api/v1/super-admin-liabilities/options/route.ts");

  assert.match(sidebar, /Lenders & Other Payables/);
  assert.match(sidebar, /Account Transfers/);
  assert.match(liabilityPage, /Opening principal|Loan received/);
  assert.match(liabilityPage, /Record payment/);
  assert.doesNotMatch(liabilityPage, /interest/i);
  assert.match(transferPage, /Cross-currency/);
  assert.match(transferPage, /Exchange-rate source/);
  assert.match(optionsRoute, /withSuperAdmin/);
});

test("settlement forms preserve the selected bank cash city or intermediary source", () => {
  const intermediaryPage = read("src/app/(dashboard)/intermediaries/page.tsx");
  const supplierPage = read("src/app/(dashboard)/suppliers/page.tsx");
  const shippingPage = read("src/app/(dashboard)/shipping-lines/page.tsx");
  const agentPage = read("src/app/(dashboard)/agents/page.tsx");

  assert.match(intermediaryPage, /superAdminCashAccountId/);
  assert.match(supplierPage, /superAdminCashAccountId/);
  assert.match(shippingPage, /superAdminBankAccountId/);
  assert.match(shippingPage, /superAdminCashAccountId/);
  assert.match(agentPage, /superAdminBankAccountId/);
  assert.match(agentPage, /superAdminCashAccountId/);
});
