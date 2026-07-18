import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} should exist`);
  return match[1];
}

test("SyncRequest has database-backed city and creator relations", () => {
  const city = modelBlock("City");
  const user = modelBlock("User");
  const syncRequest = modelBlock("SyncRequest");

  assert.match(city, /syncRequests\s+SyncRequest\[\]/);
  assert.match(user, /syncRequestsCreated\s+SyncRequest\[\]\s+@relation\("SyncRequestCreatedBy"\)/);
  assert.match(syncRequest, /city\s+City\s+@relation\(fields: \[cityId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(syncRequest, /creator\s+User\?\s+@relation\("SyncRequestCreatedBy", fields: \[createdBy\], references: \[id\], onDelete: SetNull\)/);
});

test("OpeningLiability uses type-scoped uniqueness and party check constraints", () => {
  const openingLiability = modelBlock("OpeningLiability");

  assert.doesNotMatch(openingLiability, /@@unique\(\[(supplierId|shippingLineId|agentId|intermediaryId), currencyId\]/);
  assert.match(openingLiability, /@@index\(\[supplierId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[shippingLineId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[agentId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[intermediaryId, currencyId\]/);

  const migration = readFileSync("prisma/migrations/20260703000100_audit_data_integrity/migration.sql", "utf8");
  assert.match(migration, /opening_liabilities_party_type_check/);
  assert.match(migration, /WHERE "liability_type" = 'supplier' AND "supplier_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'shipping_line' AND "shipping_line_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'agent' AND "agent_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'intermediary' AND "intermediary_id" IS NOT NULL/);
});

test("core payable party names are unique in the database schema", () => {
  for (const name of ["Supplier", "ShippingLine", "Intermediary"]) {
    assert.match(modelBlock(name), /name\s+String\s+@unique\s+@db\.VarChar\(200\)/);
  }

  const migration = readFileSync("prisma/migrations/20260703000200_unique_party_names/migration.sql", "utf8");
  assert.match(migration, /ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_key" UNIQUE \("name"\)/);
  assert.match(migration, /ALTER TABLE "shipping_lines" ADD CONSTRAINT "shipping_lines_name_key" UNIQUE \("name"\)/);
  assert.match(migration, /ALTER TABLE "intermediaries" ADD CONSTRAINT "intermediaries_name_key" UNIQUE \("name"\)/);
});

test("opening balance records use restrict deletes instead of cascade deletes", () => {
  const models = [
    "OpeningCash",
    "OpeningHajiBalance",
    "OpeningCustomerBalance",
    "OpeningStock",
    "OpeningBankBalance",
    "OpeningCheque",
    "OpeningLiability",
  ];

  for (const name of models) {
    const block = modelBlock(name);
    assert.doesNotMatch(block, /onDelete: Cascade/);
  }

  const migration = readFileSync("prisma/migrations/20260703000300_restrict_opening_balance_deletes/migration.sql", "utf8");
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});

test("city liabilities have city-scoped accounts, entries, openings, and cheque lock status", () => {
  const account = modelBlock("CityLiabilityAccount");
  const entry = modelBlock("CityLiabilityEntry");
  const opening = modelBlock("OpeningCityLiability");

  assert.match(account, /@@unique\(\[cityId, name\], name: "unique_city_liability_account_name"\)/);
  assert.match(entry, /entryType\s+CityLiabilityEntryType\s+@map\("entry_type"\)/);
  assert.match(entry, /paymentSource\s+CityLiabilityPaymentSource\?\s+@map\("payment_source"\)/);
  assert.match(opening, /@@unique\(\[accountId, currencyId\], name: "unique_opening_city_liability_account_currency"\)/);

  const migration = readFileSync("prisma/migrations/20260707090000_add_city_liabilities/migration.sql", "utf8");
  assert.match(migration, /ALTER TYPE "ChequeStatus" ADD VALUE IF NOT EXISTS 'used_for_liability'/);
  assert.match(migration, /CREATE TABLE "city_liability_accounts"/);
  assert.match(migration, /CREATE TABLE "city_liability_entries"/);
  assert.match(migration, /CREATE TABLE "opening_city_liabilities"/);
  assert.match(migration, /city_liability_entries_payment_source_check/);
});

test("Haji openings stay historical and customer-to-Haji payments get linked transfers", () => {
  const hajiTransfer = modelBlock("HajiTransfer");
  const payment = modelBlock("Payment");
  const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
  const paymentsRoute = readFileSync("src/app/api/v1/payments/route.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260710103000_link_haji_payment_transfers/migration.sql", "utf8");

  assert.match(hajiTransfer, /paymentId\s+Int\?\s+@unique\s+@map\("payment_id"\)/);
  assert.match(hajiTransfer, /payment\s+Payment\?\s+@relation\("HajiPayment", fields: \[paymentId\], references: \[id\]\)/);
  assert.match(payment, /hajiTransferPayment\s+HajiTransfer\?\s+@relation\("HajiPayment"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "payment_id"/);
  assert.match(migration, /DELETE FROM "haji_transfers"\s+WHERE "detail" LIKE 'Opening Haji balance%'/);
  assert.match(migration, /INSERT INTO "haji_transfers"/);
  assert.match(migration, /p\."destination" = 'haji'/);
  assert.match(paymentsRoute, /detail: linkedHajiTransferDetail\(createdPayment\)/);
  assert.match(paymentsRoute, /referenceNo: createdPayment\.manualVoucherNo/);
  assert.match(migration, /NULLIF\(p\."manual_voucher_no", ''\)/);
  assert.match(migration, /p\."payment_method" = 'online' THEN ' online' ELSE ' transfer'/);

  const hajiOpeningBlock = openingsRoute.match(/if \(kind === "haji"\) \{[\s\S]*?return successResponse\(\{ id: row\.id \}/);
  assert.ok(hajiOpeningBlock, "opening haji route block should exist");
  assert.doesNotMatch(hajiOpeningBlock![0], /hajiTransfer\.create/);
});

test("city expense edit keeps creation-time fields available", () => {
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const expenseUpdateRoute = readFileSync("src/app/api/v1/expenses/[id]/route.ts", "utf8");
  const expensesPage = readFileSync("src/app/(dashboard)/expenses/page.tsx", "utf8");

  assert.match(validations, /export const updateExpenseSchema = z\.object\(\{\s+lotId:/);
  assert.match(expenseUpdateRoute, /const lotChanged = nextLotId !== expense\.lotId/);
  assert.match(expenseUpdateRoute, /lotCityDistributions: \{ some: \{ cityId: expense\.cityId \} \}/);
  assert.match(expenseUpdateRoute, /lotId: nextLot\.id/);
  assert.match(expensesPage, /const openEdit = async/);
  assert.match(expensesPage, /apiCall\("\/api\/v1\/lots", \{ params: \{ limit: 100, status: "ongoing" \} \}\)/);
  assert.match(expensesPage, /lotId: form\.lotId \|\| selected\?\.lotId \|\| null/);
});

test("city payment modal owns haji expense and withdrawal creation", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");

  assert.match(paymentsPage, /<option value="haji_transfer">Haji Transfer<\/option>/);
  assert.match(paymentsPage, /<option value="expense">Expense<\/option>/);
  assert.match(paymentsPage, /<option value="withdrawal">Withdrawal<\/option>/);
  assert.match(paymentsPage, /chequePaymentIds/);
  assert.match(paymentsPage, /superAdminDestinationAccountId/);
  assert.match(paymentsPage, /paidFrom: "bank_account"/);
  assert.match(paymentsPage, /Withdrawn By \*/);
  assert.match(paymentsPage, /sourceType: "bank_account"/);
  assert.match(paymentsPage, /key: "actions", label: t\("actions"\)/);
  assert.match(paymentsPage, /item\.type === "expense" \? t\("edit_expense"\) : t\("edit"\)/);
  assert.doesNotMatch(dashboardPage, /\/haji-transfers\?create=1&embed=1/);
  assert.doesNotMatch(dashboardPage, /\/expenses\?create=1&embed=1/);
  assert.doesNotMatch(dashboardPage, /\/personal-withdrawals\?create=1&embed=1/);
});

test("payment modal haji quickform matches standalone haji creation flow", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const hajiQuickform = paymentsPage.match(/\{createType === "haji_transfer" && \([\s\S]*?\n\s*\{!isEmbed && \(/);

  assert.ok(hajiQuickform, "payments modal haji quickform should exist");
  assert.match(paymentsPage, /buildCityHajiTransferDetail/);
  assert.match(paymentsPage, /isAfghanistanCity && !hajiDetail/);
  assert.match(hajiQuickform![0], /From \*/);
  assert.match(hajiQuickform![0], /Going to \*/);
  assert.match(hajiQuickform![0], /Ref\. No\./);
  assert.match(hajiQuickform![0], /Cash Amount/);
  assert.match(hajiQuickform![0], /Slip total:/);
  assert.match(hajiQuickform![0], /formatCurrencySelectLabel/);
  assert.match(hajiQuickform![0], /\{isAfghanistanCity && \([\s\S]*\{t\("detail"\)\} \*/);
});

test("payment modal haji edit keeps source and date fields aligned", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const hajiUpdateRoute = readFileSync("src/app/api/v1/haji-transfers/[id]/route.ts", "utf8");
  const financeCombinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(paymentsPage, /transferDate: item\.date \|\| \(raw\.transferDate \? String\(raw\.transferDate\)\.slice\(0, 10\) : ""\)/);
  assert.match(paymentsPage, /sourceType: raw\.sourceType \|\| \(raw\.transferType === "direct" \? "bank_transfer" : "cash_office"\)/);
  assert.match(financeCombinedRoute, /chequePayment: \{\s+select:/);
  assert.match(paymentsPage, /existingHajiCheques: raw\.chequePayment \? \[raw\.chequePayment\] : \[\]/);
  assert.match(paymentsPage, /const hajiChequeOptions = \[/);
  assert.match(paymentsPage, /No cheque details available for this transfer/);
  assert.match(paymentsPage, /<option value="cash_office">Cash<\/option>/);
  assert.match(paymentsPage, /<option value="bank_transfer">Online<\/option>/);
  assert.match(paymentsPage, /Superadmin Account \*/);
  assert.match(paymentsPage, /Superadmin Account \*/);
  assert.match(paymentsPage, /superAdminDestinationAccountId: nextId/);
  assert.match(paymentsPage, /transferredTo: account \? formatSuperAdminBankLabel\(account\) : f\.transferredTo/);
  assert.doesNotMatch(paymentsPage, /<option value="from_in_hand">\{t\("from_in_hand"\)\}<\/option><option value="direct">\{t\("direct_transfer"\)\}<\/option>/);
  assert.match(hajiUpdateRoute, /const nextTransferType = nextSourceType === "bank_transfer" \? "direct" : "from_in_hand"/);
  assert.match(hajiUpdateRoute, /transferType: nextTransferType/);
});

test("haji party account destination feature remains removed", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const hajiRoute = readFileSync("src/app/api/v1/haji-transfers/route.ts", "utf8");
  const hajiUpdateRoute = readFileSync("src/app/api/v1/haji-transfers/[id]/route.ts", "utf8");
  const hajiPage = readFileSync("src/app/(dashboard)/haji-transfers/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  for (const source of [schema, accounting, hajiRoute, hajiUpdateRoute, hajiPage, paymentsPage]) {
    assert.doesNotMatch(source, /party_account/);
    assert.doesNotMatch(source, /destinationParty/);
    assert.doesNotMatch(source, /Party Account/);
    assert.doesNotMatch(source, /Enter party\/account name/);
  }
  assert.doesNotMatch(accounting, /getSuperAdminPartiesAccountId/);
  assert.doesNotMatch(hajiRoute, /resolvePartyDestination/);
  assert.doesNotMatch(hajiUpdateRoute, /resolvePartyDestination/);
});

test("customer ledger supports transaction type filtering", () => {
  const customerRoute = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const exportRoute = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  const ledgerExport = readFileSync("src/lib/ledger-export.ts", "utf8");

  assert.match(customerRoute, /searchParams\.get\("ledger_type"\)/);
  assert.match(customerRoute, /ledgerType === "all" \|\| t\.type === ledgerType/);
  assert.match(customersPage, /const \[ledgerTypeFilter, setLedgerTypeFilter\] = useState\("all"\)/);
  assert.match(customersPage, /<option value="sale">Sale<\/option>/);
  assert.match(customersPage, /<option value="payment">Receipt<\/option>/);
  assert.match(customersPage, /ledgerType=\{ledgerTypeFilter\}/);
  assert.match(exportRoute, /searchParams\.get\("ledger_type"\)/);
  assert.match(ledgerExport, /ledgerType\?: string/);
  assert.match(ledgerExport, /searchParams\.ledger_type = params\.ledgerType/);
});

test("GLM critical audit fixes remain wired", () => {
  const sale = modelBlock("Sale");
  const unresolved = modelBlock("LotSettlementUnresolvedOverflow");
  const cityTransferCreate = readFileSync("src/app/api/v1/city-transfers/route.ts", "utf8");
  const cityTransferApprove = readFileSync("src/app/api/v1/city-transfers/[id]/route.ts", "utf8");
  const withdrawalsCreate = readFileSync("src/app/api/v1/personal-withdrawals/route.ts", "utf8");
  const withdrawalsApprove = readFileSync("src/app/api/v1/personal-withdrawals/[id]/approve/route.ts", "utf8");
  const withdrawalsEdit = readFileSync("src/app/api/v1/personal-withdrawals/[id]/route.ts", "utf8");
  const customerRoute = readFileSync("src/app/api/v1/customers/route.ts", "utf8");
  const adminCleanupRoute = readFileSync("src/app/api/v1/admin-cleanup/route.ts", "utf8");
  const saleRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const stockActivation = readFileSync("src/lib/stock-activation.ts", "utf8");
  const withdrawalCleanupMigration = readFileSync("prisma/migrations/20260710110000_remove_pending_withdrawal_journals/migration.sql", "utf8");

  assert.match(sale, /@@unique\(\[cityId, voucherNo\], name: "unique_sale_city_voucher"\)/);
  assert.match(unresolved, /@@map\("lot_settlement_unresolved_overflows"\)/);
  assert.match(cityTransferCreate, /INSUFFICIENT_STOCK/);
  assert.match(cityTransferApprove, /pg_advisory_xact_lock/);
  assert.match(cityTransferApprove, /SENDER_INSUFFICIENT_STOCK/);
  assert.doesNotMatch(withdrawalsCreate, /journalWithdrawal\(/);
  assert.match(withdrawalsApprove, /journalWithdrawal\(/);
  assert.match(withdrawalsEdit, /Cannot edit an approved withdrawal/);
  assert.match(withdrawalsEdit, /Cannot delete an approved withdrawal/);
  assert.match(withdrawalCleanupMigration, /pw\."approved_at" IS NULL/);
  assert.match(customerRoute, /createCustomerSchema\.safeParse/);
  assert.match(adminCleanupRoute, /REQUIRED_CONFIRM_PHRASE/);
  assert.match(adminCleanupRoute, /timingSafeEqual/);
  assert.match(saleRoute, /CASE WHEN current_number >= 9999 THEN 1 ELSE current_number \+ 1 END/);
  assert.match(stockActivation, /journalSaleCOGS/);
});
