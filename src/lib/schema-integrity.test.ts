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

test("superadmin app branding settings are persisted and visible", () => {
  const migration = readFileSync("prisma/migrations/20260809120000_app_branding_settings/migration.sql", "utf8");
  const route = readFileSync("src/app/api/v1/app-branding/route.ts", "utf8");
  const settingsPage = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  const brandLogo = readFileSync("src/components/brand/BrandLogo.tsx", "utf8");
  const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.match(schema, /model AppBranding/);
  assert.match(schema, /systemName\s+String[\s\S]*@map\("system_name"\)/);
  assert.match(schema, /logoUrl\s+String\?/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "app_branding"/);
  assert.match(route, /export async function GET/);
  assert.match(route, /withAuth/);
  assert.match(route, /user\.role !== "super_admin"/);
  assert.match(route, /appBranding\.upsert/);
  assert.match(settingsPage, /type Tab = "branding"/);
  assert.match(settingsPage, /function BrandingTab/);
  assert.match(settingsPage, /APP_BRANDING_UPDATED_EVENT/);
  assert.match(brandLogo, /logoUrl\?: string \| null/);
  assert.match(loginPage, /useAppBranding/);
  assert.match(sidebar, /useAppBranding/);
});

test("superadmin dashboard country tabs do not show country flags", () => {
  const dashboardPage = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");

  assert.match(dashboardPage, /\{c as string\}/);
  assert.doesNotMatch(dashboardPage, /🇵🇰|🇦🇫/);
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
  const paymentUpdateRoute = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");
  const owedHelper = readFileSync("src/lib/ongoing-lot-haji-owed.ts", "utf8");
  const cityLedgerRoute = readFileSync("src/app/api/v1/city-ledger/route.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260710103000_link_haji_payment_transfers/migration.sql", "utf8");

  assert.match(hajiTransfer, /paymentId\s+Int\?\s+@unique\s+@map\("payment_id"\)/);
  assert.match(hajiTransfer, /payment\s+Payment\?\s+@relation\("HajiPayment", fields: \[paymentId\], references: \[id\]\)/);
  assert.match(payment, /hajiTransferPayment\s+HajiTransfer\?\s+@relation\("HajiPayment"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "payment_id"/);
  assert.match(migration, /DELETE FROM "haji_transfers"\s+WHERE "detail" LIKE 'Opening Haji balance%'/);
  assert.match(migration, /INSERT INTO "haji_transfers"/);
  assert.match(migration, /p\."destination" = 'haji'/);
  assert.match(paymentsRoute, /detail: afghanistanSettlement\?\.transferredTo \|\| linkedHajiTransferDetail\(createdPayment\)/);
  assert.match(paymentsRoute, /referenceNo: createdPayment\.manualVoucherNo/);
  assert.match(paymentUpdateRoute, /const linkedHajiTransfer = await tx\.hajiTransfer\.findUnique/);
  assert.match(paymentUpdateRoute, /if \(nextDestination === "haji" \|\| afghanistanSettlement\)/);
  assert.match(paymentUpdateRoute, /referenceNo: nextManualVoucherNo/);
  assert.match(paymentUpdateRoute, /linkedHajiTransfer\s+\?\s+await tx\.hajiTransfer\.update/);
  assert.match(paymentUpdateRoute, /:\s+await tx\.hajiTransfer\.create/);
  assert.match(paymentUpdateRoute, /journalHajiTransfer\(/);
  assert.match(paymentUpdateRoute, /else if \(linkedHajiTransfer\)/);
  assert.match(paymentUpdateRoute, /await tx\.hajiTransfer\.delete\(\{ where: \{ id: linkedHajiTransfer\.id \} \}\)/);
  assert.match(owedHelper, /where: \{ \.\.\.cityFilter, \.\.\.lotFilter, paymentId: null \}/);
  assert.match(cityLedgerRoute, /const isLinkedPaymentTransfer = Boolean\(\(h as any\)\.paymentId\)/);
  assert.match(cityLedgerRoute, /hajiCredit: !isLinkedPaymentTransfer && h\.lot\?\.status === "ongoing"/);
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
  assert.match(paymentsPage, /import WithdraweeFieldWithNew from "@\/components\/WithdraweeFieldWithNew"/);
  assert.match(paymentsPage, /<WithdraweeFieldWithNew[\s\S]*?value=\{form\.withdrawnBy \|\| ""\}/);
  assert.match(paymentsPage, /sourceType: "bank_account"/);
  assert.match(paymentsPage, /const keepCreateModalOpen = canCreateRecords/);
  assert.match(paymentsPage, /const \[createFormVersion, setCreateFormVersion\] = useState\(0\)/);
  assert.match(paymentsPage, /setCreateFormVersion\(\(version\) => version \+ 1\)/);
  assert.match(paymentsPage, /<div key=\{`create-\$\{createType\}-\$\{createFormVersion\}`\} className="space-y-3">/);
  assert.match(paymentsPage, /if \(keepCreateModalOpen\) \{\s+setLatestCreatedEntry\(buildLatestPaymentEntrySummary\(createType, body, formSnapshot, currencies, lots/);
  assert.match(paymentsPage, /setLatestCreatedEntry\(buildLatestPaymentEntrySummary\(createType, body, formSnapshot, currencies, lots[\s\S]*?resetCurrentCreateFormAfterSave\(\);/);
  assert.match(paymentsPage, /setPaymentSavedNotice\("Entry recorded\."\)/);
  assert.match(paymentsPage, /type LatestPaymentEntrySummary = \{/);
  assert.match(paymentsPage, /function buildLatestPaymentEntrySummary\(/);
  assert.match(paymentsPage, /function buildLatestPaymentEntrySummaryFromRow\(/);
  assert.match(paymentsPage, /const loadLatestCreateEntrySummary = useCallback/);
  assert.match(paymentsPage, /apiCall\("\/api\/v1\/finance\/combined", \{ params: \{ page: 1, limit: 1, type: "all" \} \}\)/);
  assert.match(paymentsPage, /setLatestCreatedEntry\(buildLatestPaymentEntrySummary\(createType, body, formSnapshot, currencies, lots/);
  assert.match(paymentsPage, /setLatestCreatedEntry\(await loadLatestCreateEntrySummary\(\)\)/);
  assert.match(paymentsPage, /\{latestCreatedEntry && \(/);
  assert.match(paymentsPage, /latestCreatedEntry\.meta\.join\(" · "\)/);
  assert.match(paymentsPage, /key: "actions", label: t\("actions"\)/);
  assert.match(paymentsPage, /item\.type === "expense" \? t\("edit_expense"\) : t\("edit"\)/);
  assert.doesNotMatch(dashboardPage, /\/haji-transfers\?create=1&embed=1/);
  assert.doesNotMatch(dashboardPage, /\/expenses\?create=1&embed=1/);
  assert.doesNotMatch(dashboardPage, /\/personal-withdrawals\?create=1&embed=1/);
});

test("city sale modal shows compact latest sale summary after save", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");

  assert.match(salesPage, /type LatestSaleSummary = \{/);
  assert.match(salesPage, /function buildLatestSaleSummary\(/);
  assert.match(salesPage, /function buildLatestSaleSummaryFromRow\(/);
  assert.match(salesPage, /const loadLatestSaleSummary = useCallback/);
  assert.match(salesPage, /apiCall\("\/api\/v1\/sales", \{ params: \{ page: 1, limit: 1 \} \}\)/);
  assert.match(salesPage, /const \[latestCreatedSale, setLatestCreatedSale\] = useState<LatestSaleSummary \| null>\(null\)/);
  assert.match(salesPage, /setLatestCreatedSale\(buildLatestSaleSummary\(/);
  assert.match(salesPage, /setLatestCreatedSale\(await loadLatestSaleSummary\(\)\)/);
  assert.match(salesPage, /\{latestCreatedSale && \(/);
  assert.match(salesPage, /latestCreatedSale\.meta\.join\(" · "\)/);
});

test("city sales list expands multi-item sales into separate display rows", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");

  assert.match(salesPage, /const displaySales = useMemo\(\(\) => \{/);
  assert.match(salesPage, /return sales\.flatMap\(\(sale: any\) => \{/);
  assert.match(salesPage, /const mergeDisplayItems = \(items: any\[\]\) => \{/);
  assert.match(salesPage, /Number\(filters\.lot_id \|\| 0\)/);
  assert.match(salesPage, /Number\(item\.lotId \|\| item\.lot\?\.id \|\| sale\.lot\?\.id \|\| 0\) === selectedLotId/);
  assert.match(salesPage, /items: \[item\]/);
  assert.match(salesPage, /sourceSale: sale/);
  assert.match(salesPage, /data=\{displaySales\}/);
  assert.match(salesPage, /openCorrect\(s\.sourceSale \|\| s\)/);
  assert.match(salesPage, /openDiscount\(s\.sourceSale \|\| s\)/);
  assert.match(salesPage, /openCancel\(s\.sourceSale \|\| s\)/);
});

test("investor attribution phase 1.4 remains preview-only and collection-independent", () => {
  const historicalPool = readFileSync("src/lib/historical-pool-attribution.ts", "utf8");
  const investorRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const investorTests = readFileSync("src/lib/investor-attribution.test.ts", "utf8");
  const provider = readFileSync("src/lib/exchange-rate-provider.ts", "utf8");
  const providerTests = readFileSync("src/lib/exchange-rate-provider.test.ts", "utf8");

  assert.match(historicalPool, /buildHistoricalFxTransaction/);
  assert.match(historicalPool, /price_increase/);
  assert.match(historicalPool, /price_reduction/);
  assert.match(historicalPool, /other_adjustment/);
  assert.match(historicalPool, /aggregateReconciliation/);
  assert.match(historicalPool, /managerAssumedAmountPkr/);
  assert.match(historicalPool, /reconciliationDifferencePkr/);
  assert.match(investorRoute, /loadLiveFxCoverage/);
  assert.match(investorRoute, /intermediaryUsdCostLayer\.findMany/);
  assert.match(investorRoute, /selectRateForPosition/);
  assert.match(provider, /MANUAL_OPEN_MARKET/);
  assert.match(provider, /SARAFI_AF/);
  assert.match(provider, /sarafiAfIntegrationStatus/);
  assert.match(provider, /No documented supported Sarafi\.af API\/feed has been approved/);
  assert.match(investorTests, /recognized financial report profit is attributed regardless of customer collection/);
  assert.match(investorTests, /phase 1\.4 missing FX rate blocks preview/);
  assert.match(providerTests, /manual USD AFN and RMB rates normalize/);
  assert.match(providerTests, /cross-rate calculation exposes AFN to USD to PKR path/);
  assert.match(providerTests, /provider change not rewriting historical result|snapshotted and not rewritten/);
  assert.doesNotMatch(historicalPool, /\.(create|update|delete|createMany|updateMany|deleteMany)\(/);
  assert.doesNotMatch(investorRoute, /journalEntry\.(create|createMany|update|delete)/);
  assert.doesNotMatch(investorRoute, /collectionEligibility|Distribution-Eligible|Pending\/Uncollected|unallocated receipt/i);
  assert.doesNotMatch(provider, /from ["']cheerio|from ["']puppeteer|from ["']playwright|innerHTML/);
});

test("investor attribution phase 2 finalization remains dry-run only", () => {
  const dryRun = readFileSync("src/lib/investor-finalization-dry-run.ts", "utf8");
  const dryRunTests = readFileSync("src/lib/investor-finalization-dry-run.test.ts", "utf8");
  const investorRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(dryRun, /export type AttributionFinalizationStatus = "DRAFT" \| "READY" \| "BLOCKED" \| "FINALIZED" \| "REVERSED"/);
  assert.match(dryRun, /finalizationButtonEnabled: false/);
  assert.match(dryRun, /Investor Capital Ledger/);
  assert.match(dryRun, /Original Finalization → Reversal → Corrected Finalization/);
  assert.match(dryRun, /BLOCKED_DUPLICATE_FINALIZATION/);
  assert.match(dryRun, /POST_FINALIZATION_ADJUSTMENT_REQUIRED/);
  assert.match(dryRunTests, /unsupported AFN and RMB positions/);
  assert.match(dryRunTests, /blocks duplicate finalized period/);
  assert.match(dryRunTests, /snapshot design is immutable/);
  assert.match(investorRoute, /buildFinalizationDryRun/);
  assert.match(investorsPage, /Finalize Preview \/ Dry Run/);
  assert.doesNotMatch(dryRun, /\.(create|update|delete|createMany|updateMany|deleteMany)\(/);
  assert.doesNotMatch(investorRoute, /finalization\.(create|update|delete|createMany|updateMany|deleteMany)/i);
  assert.doesNotMatch(investorRoute, /journalEntry\.(create|createMany|update|delete)/);
});

test("investor attribution phase 2.1 FX coverage and posting simulation stay preview-only", () => {
  const dryRun = readFileSync("src/lib/investor-finalization-dry-run.ts", "utf8");
  const liveFx = readFileSync("src/lib/live-fx-position-tracing.ts", "utf8");
  const liveFxTests = readFileSync("src/lib/live-fx-position-tracing.test.ts", "utf8");
  const dryRunTests = readFileSync("src/lib/investor-finalization-dry-run.test.ts", "utf8");
  const investorRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(liveFx, /buildLiveFxCoveragePreview/);
  assert.match(liveFx, /foreign_cash/);
  assert.match(liveFx, /customer_receivable/);
  assert.match(liveFx, /supplier_payable/);
  assert.match(liveFx, /intermediary_balance/);
  assert.match(liveFx, /shipper_balance/);
  assert.match(dryRun, /postingSimulation/);
  assert.match(dryRun, /Financial Report → Historical Pool → Investor Attribution → Finalization Snapshot → Proposed Postings/);
  assert.match(dryRun, /debitAccount/);
  assert.match(dryRun, /creditAccount/);
  assert.match(investorRoute, /liveFxCoverage/);
  assert.match(investorsPage, /Proposed Postings — Simulation Only/);
  assert.match(liveFxTests, /AFN asset and liability/);
  assert.match(liveFxTests, /RMB asset and liability/);
  assert.match(liveFxTests, /existing USD path/);
  assert.match(dryRunTests, /debitCreditDifferencePkr, 0/);
  assert.match(dryRunTests, /investor_capital_loss/);
  assert.match(dryRunTests, /profit_reinvestment/);
  assert.doesNotMatch(liveFx, /\.(create|update|delete|createMany|updateMany|deleteMany)\(/);
  assert.doesNotMatch(dryRun, /\.(create|update|delete|createMany|updateMany|deleteMany)\(/);
  assert.doesNotMatch(investorRoute, /journalEntry\.(create|createMany|update|delete)/);
});

test("sale and payment creates send stable browser sync request ids", () => {
  const apiHook = readFileSync("src/hooks/useApi.ts", "utf8");
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(apiHook, /headers\?: Record<string, string>/);
  assert.match(apiHook, /headers: \{ "Content-Type": "application\/json", \.\.\.\(options\.headers \|\| \{\}\) \}/);
  assert.match(salesPage, /createRequestRef = useRef<\{ signature: string; requestId: string \} \| null>\(null\)/);
  assert.match(salesPage, /const payloadSignature = JSON\.stringify\(payload\)/);
  assert.match(salesPage, /"x-sync-request-id": createRequestRef\.current\.requestId/);
  assert.match(salesPage, /apiCall\("\/api\/v1\/sales", \{ method: "POST", body: payload, headers: createRequestHeaders \}\)/);
  assert.match(salesPage, /if \(result\.success\) \{\s+createRequestRef\.current = null/);
  assert.match(paymentsPage, /createRequestRef = useRef<\{ signature: string; requestId: string \} \| null>\(null\)/);
  assert.match(paymentsPage, /const payloadSignature = `\$\{endpoint\}:\$\{JSON\.stringify\(body\)\}`/);
  assert.match(paymentsPage, /apiCall\(endpoint, \{ method: "POST", body, headers: createRequestHeaders \}\)/);
  assert.match(paymentsPage, /if \(r\.success\) \{\s+createRequestRef\.current = null/);
});

test("sale and payment modals defer list refresh until after success UI paints", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const saleCreateSubmit = salesPage.slice(salesPage.indexOf("const handleSubmit = async () => {"), salesPage.indexOf("useEffect(() => {", salesPage.indexOf("const handleSubmit = async () => {")));
  const paymentCreateSubmit = paymentsPage.slice(paymentsPage.indexOf("const handleCreate = async"), paymentsPage.indexOf("// ── Add current form to batch queue"));

  assert.match(salesPage, /const refreshSalesAfterPaint = useCallback\(\(\) => \{\s+window\.setTimeout\(\(\) => loadSales\(\), 0\);/);
  assert.match(saleCreateSubmit, /setLatestCreatedSale\(buildLatestSaleSummary[\s\S]*?resetSaleCreateForm\(\);[\s\S]*?setSaleSavedNotice\("Sale recorded[\s\S]*?refreshSalesAfterPaint\(\);/);
  assert.doesNotMatch(saleCreateSubmit, /setSaleSavedNotice\("Sale recorded[\s\S]*?loadSales\(\);/);
  assert.match(paymentsPage, /const refreshToLatestPaymentsAfterPaint = useCallback\(\(\) => \{\s+window\.setTimeout\(\(\) => refreshToLatestPayments\(\), 0\);/);
  assert.match(paymentCreateSubmit, /setLatestCreatedEntry\(buildLatestPaymentEntrySummary[\s\S]*?resetCurrentCreateFormAfterSave\(\);[\s\S]*?setPaymentSavedNotice\("Entry recorded\."\);[\s\S]*?refreshToLatestPaymentsAfterPaint\(\);/);
  assert.doesNotMatch(paymentCreateSubmit, /setPaymentSavedNotice\("Entry recorded\."\);[\s\S]*?refreshToLatestPayments\(\);/);
});

test("sticky quickform and modal footers hide scrolled fields beneath actions", () => {
  const globals = readFileSync("src/app/globals.css", "utf8");
  const quickformFooter = globals.slice(globals.indexOf(".quickform-embed .quickform-footer"), globals.indexOf(".quickform-embed .btn-primary"));
  const modalActionsFooter = globals.slice(globals.indexOf(".modal-actions-sticky"), globals.indexOf("@media (max-width: 639px)"));

  assert.match(quickformFooter, /sticky bottom-0/);
  assert.match(quickformFooter, /bg-\[#fff8ef\]/);
  assert.match(quickformFooter, /overflow: hidden/);
  assert.match(quickformFooter, /calc\(env\(safe-area-inset-bottom\) \+ 1rem\)/);
  assert.doesNotMatch(quickformFooter, /bg-\[rgba/);
  assert.match(modalActionsFooter, /sticky bottom-0/);
  assert.match(modalActionsFooter, /bg-white/);
  assert.doesNotMatch(modalActionsFooter, /bg-\[rgba/);
});

test("dashboard modules use shimmer table skeletons while loading", () => {
  const skeleton = readFileSync("src/components/ui/skeleton.tsx", "utf8");
  const uiIndex = readFileSync("src/components/ui/index.tsx", "utf8");
  const globals = readFileSync("src/app/globals.css", "utf8");
  const routeLoading = readFileSync("src/app/(dashboard)/loading.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");
  const inventoryPage = readFileSync("src/app/(dashboard)/inventory/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");

  assert.match(skeleton, /function TableSkeleton/);
  assert.match(skeleton, /function PageSkeleton/);
  assert.match(skeleton, /className=\{cn\("skeleton-line"/);
  assert.match(uiIndex, /<TableSkeleton columns=\{Math\.max\(columns\.length, 3\)\} compact=\{compact\} \/>/);
  assert.doesNotMatch(uiIndex, /<ProcessingSpinner size="md" label="Loading" \/>/);
  assert.match(routeLoading, /<PageSkeleton \/>/);
  assert.match(dashboardPage, /function DashboardSkeleton/);
  assert.match(dashboardPage, /return <DashboardSkeleton \/>/);
  assert.match(dashboardPage, /<TableSkeleton columns=\{4\} rows=\{5\} compact \/>/);
  assert.doesNotMatch(dashboardPage, /Loading dashboard\.\.\./);
  assert.match(inventoryPage, /PageSkeleton/);
  assert.doesNotMatch(inventoryPage.slice(inventoryPage.indexOf("if (loading || !data)"), inventoryPage.indexOf("const isCityAdmin")), /animate-spin/);
  assert.match(skeleton, /function ModalFormSkeleton/);
  assert.match(uiIndex, /ModalFormSkeleton/);
  assert.match(paymentsPage, /setShowCreate\(true\);[\s\S]*?const \{ loadedCurrencies \} = await loadHelpers\(\)/);
  assert.match(paymentsPage, /setShowEdit\(true\);[\s\S]*?const \{ loadedCurrencies \} = await loadHelpers\(\)/);
  assert.match(paymentsPage, /!createFormReady \? \(\s*<ModalFormSkeleton \/>/);
  assert.match(salesPage, /setShowCreate\(true\);[\s\S]*?const loaded = await loadDropdowns\(\)/);
  assert.match(salesPage, /setShowCorrect\(true\);[\s\S]*?if \(!products\.length\) await loadDropdowns\(\)/);
  assert.match(salesPage, /!saleCreateFormReady \? \(\s*<ModalFormSkeleton \/>/);
  assert.match(salesPage, /!saleCorrectFormReady \? \(\s*<ModalFormSkeleton \/>/);
  assert.match(globals, /\.skeleton-line::after/);
  assert.match(globals, /@keyframes skeleton-line-fill/);
  assert.match(globals, /@keyframes skeleton-shimmer/);
  assert.match(globals, /@keyframes skeleton-row-fade/);
});

test("city sale and payment customer search does not auto-show walk-in shortcut", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const customerField = readFileSync("src/components/CustomerFieldWithNew.tsx", "utf8");
  const customerSearch = readFileSync("src/components/CustomerSearch.tsx", "utf8");

  assert.match(customerSearch, /showWalkInShortcut = true/);
  assert.match(customerSearch, /\{showWalkInShortcut && \(/);
  assert.match(customerField, /showWalkInShortcut=\{showWalkInShortcut\}/);
  assert.match(salesPage, /showWalkInShortcut=\{false\}/);
  assert.match(paymentsPage, /showWalkInShortcut=\{false\}/);
});

test("quickform and modal fields show focus highlight on every edge", () => {
  const globals = readFileSync("src/app/globals.css", "utf8");
  const focusRule = globals.slice(globals.indexOf(".quickform-embed .input-field:focus,"), globals.indexOf(".quickform-embed label {"));

  assert.match(focusRule, /\.quickform-embed \.input-field:focus/);
  assert.match(focusRule, /\.modal-sheet-body \.input-field:focus/);
  assert.match(focusRule, /\[data-radix-dialog-content\] \.select-field:focus/);
  assert.match(focusRule, /border-color: #6b0f1a/);
  assert.match(focusRule, /outline: 2px solid #6b0f1a/);
  assert.match(focusRule, /outline-offset: -2px/);
});

test("payment create replays sync request before side-effect validation", () => {
  const paymentsRoute = readFileSync("src/app/api/v1/payments/route.ts", "utf8");
  const syncMetaIndex = paymentsRoute.indexOf("const syncMeta = getSyncRequestMeta(request);", paymentsRoute.indexOf("export const POST"));
  const bodyParseIndex = paymentsRoute.indexOf("const body = await request.json();", syncMetaIndex);
  const chequeDuplicateIndex = paymentsRoute.indexOf("city-payment-cheque", syncMetaIndex);
  const replayBlock = paymentsRoute.slice(syncMetaIndex, bodyParseIndex);

  assert.ok(syncMetaIndex > -1);
  assert.ok(bodyParseIndex > syncMetaIndex);
  assert.ok(chequeDuplicateIndex > bodyParseIndex);
  assert.match(replayBlock, /unique_sync_request_per_city_module/);
  assert.match(replayBlock, /module: PAYMENT_SYNC_MODULE/);
  assert.match(replayBlock, /return successResponse\(formatPaymentCreateResponse\(existingPayment\), "Payment already synced"\)/);
});

test("payment create transaction has Railway Neon-safe timeout", () => {
  const paymentsRoute = readFileSync("src/app/api/v1/payments/route.ts", "utf8");

  assert.match(paymentsRoute, /PAYMENT_CREATE_TRANSACTION_OPTIONS = \{ maxWait: 15_000, timeout: 30_000 \}/);
  assert.match(paymentsRoute, /prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(paymentsRoute, /\}, PAYMENT_CREATE_TRANSACTION_OPTIONS\);/);
});

test("city sales support per-item lot selection and locked completed sale item lots", () => {
  const sale = modelBlock("Sale");
  const saleItem = modelBlock("SaleItem");
  const lot = modelBlock("Lot");
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const saleDetailRoute = readFileSync("src/app/api/v1/sales/[id]/route.ts", "utf8");
  const saleCorrectRoute = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260721090000_add_sale_item_lots/migration.sql", "utf8");

  assert.match(saleItem, /lotId\s+Int\s+@map\("lot_id"\)/);
  assert.match(saleItem, /lot\s+Lot\s+@relation\(fields: \[lotId\], references: \[id\], onDelete: Restrict\)/);
  assert.match(saleItem, /@@index\(\[lotId\]\)/);
  assert.match(lot, /saleItems\s+SaleItem\[\]/);
  assert.match(sale, /items\s+SaleItem\[\]/);
  assert.match(migration, /ADD COLUMN "lot_id" INTEGER/);
  assert.match(migration, /UPDATE "sale_items" si\s+SET "lot_id" = s\."lot_id"/);
  assert.match(validations, /lotId: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(salesRoute, /const itemLotIds: number\[\] = Array\.from\(new Set<number>\(normalizedItems\.map\(\(i\) => Number\(i\.lotId \|\| 0\)\)\)\)/);
  assert.match(salesRoute, /lotId: i\.lotId/);
  assert.match(salesRoute, /item\.lotId/);
  assert.match(saleDetailRoute, /lot: i\.lot/);
  assert.match(saleCorrectRoute, /lockedLotId/);
  assert.match(saleCorrectRoute, /lockedLot\.status === "completed"/);
  assert.match(saleCorrectRoute, /const nextGodownId = Number\(body\.godownId \|\| sale\.godownId \|\| 0\)/);
  assert.match(saleCorrectRoute, /const nextSaleDate = body\.saleDate \? new Date\(body\.saleDate\) : sale\.saleDate/);
  assert.match(saleCorrectRoute, /saleDate: nextSaleDate/);
  assert.match(saleCorrectRoute, /saleDate: nextSaleDate, createdBy: user\.userId/);
  assert.match(saleCorrectRoute, /await canAccessGodown\(sale\.cityId, godown\.id, godown\.cityId\)/);
  assert.match(saleCorrectRoute, /godownId: nextGodownId/);
  assert.match(saleCorrectRoute, /const candidateLots = await prisma\.lot\.findMany/);
  assert.match(saleCorrectRoute, /OR: \[\{ status: "ongoing" \}, \{ id: \{ in: lotIds \} \}\]/);
  assert.match(saleCorrectRoute, /const oldQtyByLotProduct = sale\.items\.reduce/);
  assert.match(saleCorrectRoute, /allocatedItemsForSave\.push\(\.\.\.allocatedItems\)/);
  assert.match(saleCorrectRoute, /consolidateSaleLotAllocationItems\(allocatedItemsForSave, roundMoney\)/);
  assert.match(saleCorrectRoute, /const newItemData = normalizedItems\.map/);
  assert.match(salesRoute, /consolidateSaleLotAllocationItems\(allocatedItems, roundMoney\)/);
  assert.match(salesPage, /const itemMap = new Map<string, any>\(\)/);
  assert.match(salesPage, /updateItem\(idx, "lotId"/);
  assert.match(salesPage, /isSaleItemLotLocked\(item\)/);
  assert.match(salesPage, /const \[correctGodownId, setCorrectGodownId\] = useState\(0\)/);
  assert.match(salesPage, /const \[correctSaleDate, setCorrectSaleDate\] = useState\(""\)/);
  assert.match(salesPage, /setCorrectGodownId\(saleGodownId\)/);
  assert.match(salesPage, /setCorrectSaleDate\(sale\.saleDate \|\| ""\)/);
  assert.match(salesPage, /value=\{correctSaleDate\}/);
  assert.match(salesPage, /Edit reason \*/);
  assert.doesNotMatch(salesPage.slice(salesPage.indexOf("CORRECT SALE ITEMS MODAL"), salesPage.indexOf("HARD DELETE 2FA MODAL")), /\{t\("cancel_reason"\)\}/);
  assert.match(salesPage, /body: \{ saleDate: correctSaleDate, godownId: correctGodownId, items: expandedItems, reason: correctReason \}/);
  assert.match(saleCorrectRoute, /const nextSaleLotId = Number\(newItemData\[0\]\?\.lotId \|\| sale\.lotId \|\| 0\)/);
  assert.match(saleCorrectRoute, /lotId: nextSaleLotId/);
  assert.match(saleCorrectRoute, /journalSaleCreated\(\{[\s\S]*lotId: nextSaleLotId/);
  assert.match(salesPage, /lotOptionsForItem = \(item: any, includeOwnCorrectQty = false\)/);
  assert.match(salesPage, /filter\(\(lot: any\) => Number\(lot\.available \|\| 0\) \+ \(includeOwnCorrectQty \? ownCorrectItemQty\(item, Number\(lot\.lotId\)\) : 0\) > 0\)/);
  assert.match(salesPage, /includeOwnCorrectQty && item\?\.id/);
  assert.match(salesPage, /const sourceLotId = i\.lotId \|\| i\.lot\?\.id \|\| sale\.lot\?\.id \|\| 0/);
  assert.match(salesPage, /const lotId = sourceLot\?\.status === "completed" \? sourceLotId : 0/);
  assert.match(salesPage, /const key = \[productId, sourceLotId, ratePerCarton\]\.join\(":"\)/);
  assert.doesNotMatch(salesPage, /ids\.unshift\(oldLotId\)/);
  assert.doesNotMatch(salesPage, /ids\.splice\(1, 0, oldLotId\)/);
  assert.match(salesPage, /\.\.\.\(field === "productId" \? \{ lotId: 0, remainingLotId: 0 \} : \{\}\)/);
  assert.match(salesPage, /\.\.\.\(field === "lotId" \? \{ remainingLotId: 0 \} : \{\}\)/);
  assert.match(salesPage, /grid grid-cols-1 gap-2 items-end sm:grid-cols-2 lg:grid-cols-5/);
  assert.match(salesPage, /col-span-1 flex items-center gap-2 text-\[11px\] text-blue-700 sm:col-span-2 lg:col-span-5/);
});

test("city sales auto lot selection expands sale items across FIFO lot availability", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const godownStockRoute = readFileSync("src/app/api/v1/inventory/godown-stock/route.ts", "utf8");

  assert.match(salesPage, /<option value=\{0\}>Auto<\/option>/);
  assert.match(salesPage, /autoLotAllocationPreview/);
  assert.match(salesPage, /expandAutoLotItems/);
  assert.match(salesRoute, /allocateSaleItemAcrossLots/);
  assert.match(salesRoute, /getAvailableLotsForProduct/);
  assert.match(salesRoute, /Lot is required for each product/);
  assert.match(salesRoute, /exceeds available stock/);
  assert.match(salesRoute, /db\.cityTransfer\.aggregate/);
  assert.match(salesRoute, /status: \{ in: \["approved", "pending"\] \}/);
  assert.match(salesRoute, /availableLots: await getAvailableLotsForProduct\(cityId, user\.countryId!, godownId, item\.productId\)/);
  assert.match(godownStockRoute, /lotBreakdown/);
  assert.match(godownStockRoute, /city_transferred_out/);
  assert.match(godownStockRoute, /ct\.status IN \('approved', 'pending'\)/);
  assert.match(godownStockRoute, /city_transferred_in/);
  assert.match(godownStockRoute, /ct\.status = 'approved'/);
  const saleCorrectRoute = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");
  assert.match(saleCorrectRoute, /ct\.status IN \('approved', 'pending'\)/);
  assert.match(salesPage, /const saleGodownId = Number\(sale\.godownId \|\| sale\.godown\?\.id \|\| 0\)/);
  assert.match(salesPage, /if \(saleGodownId\) await loadGodownStock\(saleGodownId\)/);
  assert.match(salesPage, /const expandedItems = expandAutoLotItems\(validItems, true\)/);
  assert.match(salesPage, /body: \{ saleDate: correctSaleDate, godownId: correctGodownId, items: expandedItems, reason: correctReason \}/);
  assert.match(salesPage, /<option value=\{0\}>Auto<\/option>\{lotOptionsForItem\(item, true\)/);
  assert.match(salesPage, /autoLotAllocationPreview\(item, true\)/);
  assert.match(salesPage, /selectedLotRemainderQty/);
  assert.match(salesPage, /remainingLotOptionsForItem/);
  assert.match(salesPage, /Auto oldest lot/);
});

test("city lot detail sold metrics use real sale item lot ids", () => {
  const cityLotAssignment = readFileSync("src/lib/city-lot-assignment.ts", "utf8");
  const lotsRoute = readFileSync("src/app/api/v1/lots/route.ts", "utf8");
  const lotDetailRoute = readFileSync("src/app/api/v1/lots/[id]/route.ts", "utf8");
  const getMetricsStart = cityLotAssignment.indexOf("export async function getCitySoldMetrics");
  const getMetricsEnd = cityLotAssignment.indexOf("export async function buildCityLotAssignmentDetail", getMetricsStart);
  const getMetricsBlock = cityLotAssignment.slice(getMetricsStart, getMetricsEnd);

  assert.ok(getMetricsStart >= 0, "city sold metrics helper should exist");
  assert.match(lotsRoute, /const where: any = \{ isLegacyStock: false \}/);
  assert.match(cityLotAssignment, /import \{ aggregateLotSalesMetrics, aggregateSingleLotSalesMetrics, fetchLotSalesForMetrics \}/);
  assert.match(getMetricsBlock, /aggregateLotSalesMetrics\(sales\)\.get\(lotId\)/);
  assert.doesNotMatch(getMetricsBlock, /aggregateSingleLotSalesMetrics\(sales\)/);
  assert.match(lotDetailRoute, /OR: \[\{ lotId: id \}, \{ items: \{ some: \{ lotId: id \} \} \}\]/);
  assert.match(lotDetailRoute, /items: \{ where: \{ lotId: id \}/);
  assert.match(lotDetailRoute, /totalSales = sales\.reduce\(\(sum: number, sale: any\) => \(/);
  assert.match(lotDetailRoute, /totalAmount: \(s\.items \|\| \[\]\)\.reduce/);
});

test("city date filters default to all dates", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const reportsPage = readFileSync("src/app/(dashboard)/reports/page.tsx", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(salesPage, /const \[filters, setFilters\] = useState\(\{ status: "", lot_id: "", date_from: "", date_to: "", query: "" \}\)/);
  assert.match(salesPage, /const \[dateRangePreset, setDateRangePreset\] = useState<"today" \| "last7" \| "month" \| "all" \| "custom">\("all"\)/);
  assert.match(reportsPage, /const \[filters, setFilters\] = useState\(\{\s+date_from: "",\s+date_to: "",/);
  assert.match(reportsPage, /const \[datePreset, setDatePreset\] = useState<DatePreset>\("all"\)/);
  assert.match(paymentsPage, /const \[dateRangePreset, setDateRangePreset\] = useState<"today" \| "last7" \| "month" \| "all" \| "custom">\("all"\)/);
});

test("sales custom date filters fit without forced horizontal scrolling", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const fromDateInput = salesPage.slice(salesPage.indexOf('aria-label="From date"') - 220, salesPage.indexOf('aria-label="From date"') + 60);
  const toDateInput = salesPage.slice(salesPage.indexOf('aria-label="To date"') - 220, salesPage.indexOf('aria-label="To date"') + 60);

  assert.match(salesPage, /dateRangePreset === "custom" \? "flex-wrap overflow-visible"/);
  assert.match(fromDateInput, /flex-\[1_1_7rem\]/);
  assert.match(toDateInput, /flex-\[1_1_7rem\]/);
  assert.doesNotMatch(fromDateInput, /shrink-0/);
  assert.doesNotMatch(toDateInput, /shrink-0/);
});

test("sales exports follow active filters without pagination", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const exportButtons = readFileSync("src/components/LedgerExportButtons.tsx", "utf8");
  const ledgerExport = readFileSync("src/lib/ledger-export.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  const exportParamsType = ledgerExport.slice(ledgerExport.indexOf("export type LedgerExportParams"), ledgerExport.indexOf("export function buildLedgerExportParams"));
  const buildParamsBlock = ledgerExport.slice(ledgerExport.indexOf("export function buildLedgerExportParams"), ledgerExport.indexOf("export function buildLedgerExportUrl"));

  assert.match(salesPage, /dateFrom=\{filters\.date_from \|\| undefined\}/);
  assert.match(salesPage, /dateTo=\{filters\.date_to \|\| undefined\}/);
  assert.match(salesPage, /query=\{filters\.query\}/);
  assert.match(salesPage, /status=\{filters\.status \|\| undefined\}/);
  assert.match(salesPage, /lotId=\{filters\.lot_id \|\| undefined\}/);
  assert.match(exportButtons, /lotId\?: string \| number/);
  assert.match(ledgerExport, /searchParams\.lot_id = String\(params\.lotId\)/);
  assert.match(exportRoute, /const lotId = searchParams\.get\("lot_id"\)/);
  assert.match(exportRoute, /\?\s+\{ items: \{ some: \{ lotId \} \} \}/);
  assert.match(exportRoute, /const exportItems = lotId \? s\.items\.filter\(\(item\) => item\.lotId === lotId\) : s\.items/);
  assert.doesNotMatch(exportRoute, /OR: \[\{ lotId \}, \{ items: \{ some: \{ lotId \} \} \}\]/);
  assert.doesNotMatch(exportParamsType, /page|limit/);
  assert.doesNotMatch(buildParamsBlock, /page|limit/);
  assert.doesNotMatch(exportButtons, /page|limit/);
});

test("sales lot filter uses sale item lots for pagination", () => {
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");

  assert.match(salesRoute, /const itemWhere: any = \{\}/);
  assert.match(salesRoute, /if \(lotId\) itemWhere\.lotId = lotId/);
  assert.match(salesRoute, /if \(productId\) itemWhere\.productId = productId/);
  assert.match(salesRoute, /baseWhere\.items = \{ some: itemWhere \}/);
  assert.doesNotMatch(salesRoute, /baseWhere\.OR = \[\{ lotId \}, \{ items: \{ some: \{ lotId \} \} \}\]/);
});

test("sales pagination footer uses visible expanded row count", () => {
  const salesPage = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const ui = readFileSync("src/components/ui/index.tsx", "utf8");

  assert.match(salesPage, /visibleCount: displaySales\.length/);
  assert.match(ui, /visibleCount\?: number/);
  assert.match(ui, /Showing \$\{pagination\.visibleCount\} of \$\{pagination\.total\} transactions/);
});

test("customer ledger sale details stay complete with at-rate display across table and PDF", () => {
  const customerRoute = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const ledgerExport = readFileSync("src/lib/ledger-export.ts", "utf8");

  assert.match(customerRoute, /formatCustomerLedgerSaleItemDetail/);
  assert.match(customerRoute, /formatCustomerLedgerSaleItemRate/);
  assert.match(customerRoute, /\.\.\.sales\.flatMap\(\(s\) => \(s\.items \|\| \[\]\)\.map\(\(item\) =>/);
  assert.match(customerRoute, /debit: \["active", "marked_short"\]\.includes\(s\.status\) \? Number\(item\.amount\) : 0/);
  assert.match(exportRoute, /formatCustomerLedgerSaleItemDetail/);
  assert.match(exportRoute, /formatCustomerLedgerSaleItemRate/);
  assert.match(exportRoute, /\.\.\.sales\.flatMap\(\(s\) => \(s\.items \|\| \[\]\)\.map\(\(item\) =>/);
  assert.match(exportRoute, /debit: s\.status === "active" \? Number\(item\.amount\) : 0/);
  assert.match(customersPage, /function compactCustomerLedgerDetail\(entry/);
  assert.doesNotMatch(customersPage, /slice\(0,\s*40\)/);
  assert.match(customersPage, /whitespace-normal/);
  assert.match(customersPage, /break-words/);
  assert.match(ledgerExport, /overflow-wrap: anywhere/);
  assert.match(ledgerExport, /white-space: normal/);
});

test("customer ledger rows use alternating colors", () => {
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");

  assert.match(customersPage, /i % 2 === 1 \? "bg-\[#fafafa\]" : "bg-white"/);
  assert.match(customersPage, /hover:bg-\[#f5e8eb\]/);
  assert.match(customersPage, /e\.status === "cancelled" \? "opacity-40 line-through" : ""/);
});

test("customer ledger filters stay compact in city modal", () => {
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const filterPanel = customersPage.slice(customersPage.indexOf("Search entries…") - 500, customersPage.indexOf("<GlassButton", customersPage.indexOf("Search entries…")) + 500);
  const loadingBlock = customersPage.slice(customersPage.indexOf("{ledgerLoading ? ("), customersPage.indexOf(") : ledgerData ? ("));

  assert.match(filterPanel, /grid grid-cols-2 items-end gap-2/);
  assert.match(filterPanel, /lg:grid-cols-\[minmax\(10rem,1fr\)_7rem_7\.5rem_7\.5rem\]/);
  assert.match(filterPanel, /h-8 min-h-8 w-full py-1\.5 text-sm/);
  assert.match(filterPanel, /className="h-8 w-full px-2 text-sm"/);
  assert.match(filterPanel, /className="col-span-2 h-8 justify-self-end px-3 text-sm lg:col-span-4"/);
  assert.match(loadingBlock, /<TableSkeleton columns=\{5\} rows=\{7\} compact \/>/);
  assert.doesNotMatch(loadingBlock, /animate-spin/);
  assert.doesNotMatch(filterPanel, /flex flex-col gap-3/);
});

test("city inventory avoids focus auto-refresh and keeps stock movement filters compact", () => {
  const inventoryPage = readFileSync("src/app/(dashboard)/inventory/page.tsx", "utf8");
  const movementFilters = inventoryPage.slice(inventoryPage.indexOf("Stock Movements"), inventoryPage.indexOf("{ledgerLoading", inventoryPage.indexOf("Stock Movements")));

  assert.doesNotMatch(inventoryPage, /addEventListener\("focus"/);
  assert.doesNotMatch(inventoryPage, /addEventListener\("pageshow"/);
  assert.doesNotMatch(movementFilters, />\s*Refresh\s*</);
  assert.match(movementFilters, /grid grid-cols-2 items-end gap-2/);
  assert.match(movementFilters, /lg:grid-cols-\[minmax\(10rem,1fr\)_minmax\(10rem,1fr\)_8rem_8rem\]/);
  assert.match(movementFilters, /h-8 min-h-8 w-full py-1\.5 text-sm/);
  assert.match(movementFilters, /MobileDateInput/);
});

test("payment modal haji quickform matches standalone haji creation flow", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const hajiQuickform = paymentsPage.match(/\{createType === "haji_transfer" && \([\s\S]*?Slip total:/);

  assert.ok(hajiQuickform, "payments modal haji quickform should exist");
  assert.match(paymentsPage, /buildCityHajiTransferDetail/);
  assert.match(paymentsPage, /isAfghanistanCity && !hajiDetail/);
  assert.match(hajiQuickform![0], /From \*/);
  assert.match(hajiQuickform![0], /Going to \*/);
  assert.match(hajiQuickform![0], /Ref\. No\./);
  assert.match(hajiQuickform![0], /Cash Amount/);
  assert.match(paymentsPage, /Slip total:/);
  assert.match(paymentsPage, /formatCurrencySelectLabel/);
  assert.doesNotMatch(hajiQuickform![0], /\{t\("lot"\)\}/);
  assert.match(paymentsPage, /sourceType: isAfghanistanCity[\s\S]*\? form\.sourceType/);
  assert.match(paymentsPage, /amount: form\.sourceType === "cheque" \? selectedHajiChequeTotal : Number\(form\.amount \|\| 0\)/);
  assert.match(paymentsPage, /const hajiDetail = isAfghanistanCity[\s\S]*String\(form\.detail \|\| ""\)\.trim\(\)/);
});

test("payment modal haji edit keeps source and date fields aligned", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const hajiUpdateRoute = readFileSync("src/app/api/v1/haji-transfers/[id]/route.ts", "utf8");
  const financeCombinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(paymentsPage, /transferDate:\s*normalizeEditDate\(raw\.transferDate, item\.date\)/);
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

test("payment modal edit reuses create validation and supports type switching", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(paymentsPage, /const buildInitialFormForType = useCallback/);
  assert.match(paymentsPage, /const buildSubmissionForType = async \(type: string, forceVoucher = false\)/);
  assert.match(paymentsPage, /const switchEditType = \(nextType: string\) =>/);
  assert.match(paymentsPage, /onChange=\{\(e\) => switchEditType\(e\.target\.value\)\}/);
  assert.match(paymentsPage, /if \(originalType && createType !== originalType\)/);
  assert.match(paymentsPage, /Changing payment type requires internet so the old entry can be reversed safely/);
  assert.match(paymentsPage, /const cleanupEndpoint = originalType === "payment" \? `\/api\/v1\/payments\/\$\{id\}\/cancel`/);
  assert.match(paymentsPage, /const cleanupMethod = originalType === "payment" \? "PUT" : "DELETE"/);
  assert.match(paymentsPage, /const submission = await buildSubmissionForType\(createType, originalType === createType\)/);
  const editModalSource = paymentsPage.slice(paymentsPage.indexOf("<Modal open={showEdit}"), paymentsPage.indexOf("{/* ── VOUCHER DUPLICATE WARNING"));
  assert.match(editModalSource, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(editModalSource, /grid grid-cols-1 gap-3 sm:grid-cols-2 \$\{currencies\.length > 1 \? "lg:grid-cols-4" : "lg:grid-cols-3"\}/);
});

test("receive payment amount appears after method and account fields", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  const simplifiedStart = paymentsPage.indexOf('{simplifyModals && createType === "payment" ? (');
  const simplifiedAccount = paymentsPage.indexOf("getPakistanPaymentAccountSelectValue(form)", simplifiedStart);
  const simplifiedAmount = paymentsPage.indexOf('{t("amount")} *', simplifiedAccount);
  assert.ok(simplifiedStart >= 0, "simplified receive payment section should exist");
  assert.ok(simplifiedAccount > simplifiedStart, "simplified account fields should appear before amount");
  assert.ok(simplifiedAmount > simplifiedAccount, "simplified amount should appear after account fields");
  assert.match(paymentsPage, /preserveSignedPaymentAmount\(value, rawValue\)/);
  assert.match(paymentsPage, /rawValue === "\." \|\| rawValue === "-\." \|\| rawValue\.endsWith\("\."\)/);

  const createMethod = paymentsPage.indexOf('{createType === "payment" && !isAfghanistanCity && createFormReady && (');
  const createAmount = paymentsPage.indexOf('{createType === "payment" && (', createMethod);
  assert.ok(createMethod >= 0, "create payment method fields should exist");
  assert.ok(createAmount > createMethod, "create payment amount should appear after method fields");

  const editStart = paymentsPage.indexOf("<Modal open={showEdit}");
  const editMethod = paymentsPage.indexOf('{t("payment_method")}', editStart);
  const editAmount = paymentsPage.indexOf('{t("amount")} *', editMethod);
  assert.ok(editMethod > editStart, "edit payment method fields should exist");
  assert.ok(editAmount > editMethod, "edit payment amount should appear after method fields");
});

test("afghanistan receive payment uses target selector instead of manual detail", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const createRoute = readFileSync("src/app/api/v1/payments/route.ts", "utf8");
  const updateRoute = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");
  const combinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(paymentsPage, /renderAfghanistanPaymentMethodSelect/);
  assert.match(paymentsPage, /<option value="cash">Cash<\/option>/);
  assert.match(paymentsPage, /<optgroup label="Intermediaries">/);
  assert.match(paymentsPage, /<optgroup label="Superadmin cash pots">/);
  assert.match(paymentsPage, /buildAfghanistanPaymentPayload/);
  assert.match(paymentsPage, /formatAfghanistanCityPaymentDetail/);
  assert.match(paymentsPage, /const linkedHajiTransfer = raw\.hajiTransferPayment \|\| null/);
  assert.match(paymentsPage, /createType !== "haji_transfer" && !\(createType === "payment" && isAfghanistanCity\)/);

  assert.match(createRoute, /resolveAfghanistanSettlement/);
  assert.match(createRoute, /destination = "our_account"/);
  assert.match(createRoute, /createdPayment\.destination === "haji" \|\| afghanistanSettlement/);
  assert.match(updateRoute, /existingLinkedHajiTransfer/);
  assert.match(updateRoute, /nextDestination = "our_account"/);
  assert.match(updateRoute, /nextDestination === "haji" \|\| afghanistanSettlement/);
  assert.match(updateRoute, /hajiTransfer\.delete/);
  assert.match(combinedRoute, /hajiTransferPayment: \{/);
  assert.match(combinedRoute, /\? p\.detail/);
});

test("payments date range defaults to all dates", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(paymentsPage, /const \[fromDate, setFromDate\] = useState\(""\)/);
  assert.match(paymentsPage, /const \[toDate, setToDate\] = useState\(""\)/);
  assert.match(paymentsPage, /useState<"today" \| "last7" \| "month" \| "all" \| "custom">\("all"\)/);
});

test("payment modals preserve selected date after type changes and saves", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(paymentsPage, /const preserveDatePreset = \{\s+paymentDate: currentDate,\s+expenseDate: currentDate,\s+transferDate: currentDate,\s+withdrawalDate: currentDate,\s+\}/);
  assert.match(paymentsPage, /setForm\(buildInitialFormForType\(createType, currencies, preserveDatePreset\)\)/);
  assert.match(paymentsPage, /const selectedDate = form\.paymentDate \|\| new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/);
  assert.match(paymentsPage, /paymentDate: selectedDate/);
});

test("payment creation date pickers close after selecting a day", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const mobileDateInput = readFileSync("src/components/ui/MobileDateInput.tsx", "utf8");

  assert.match(mobileDateInput, /closeOnSelect\?: boolean/);
  assert.match(mobileDateInput, /if \(closeOnSelect\) e\.currentTarget\.blur\(\)/);
  assert.match(paymentsPage, /<MobileDateInput[\s\S]*?closeOnSelect/);
  assert.doesNotMatch(paymentsPage, /type="date"[\s\S]*?e\.currentTarget\.blur\(\)/);
});

test("city payment ref column shows linked haji transfer reference numbers", () => {
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const cityColumns = paymentsPage.slice(paymentsPage.indexOf("] : ["));

  assert.match(cityColumns, /key: "ref", label: "Ref No\."/);
  assert.match(cityColumns, /item\.type === "haji_transfer"\s+\?\s+item\.raw\?\.referenceNo\s+:\s+item\.raw\?\.manualVoucherNo/);
});

test("combined payments search covers non-payment row details", () => {
  const financeCombinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(financeCombinedRoute, /\{ referenceNo: \{ contains: query, mode: "insensitive" \} \}/);
  assert.match(financeCombinedRoute, /chequePayment: \{\s+manualVoucherNo: \{ contains: query, mode: "insensitive" \}/);
  assert.match(financeCombinedRoute, /chequePayment: \{\s+customer: \{\s+name: \{ contains: query, mode: "insensitive" \}/);
  assert.match(financeCombinedRoute, /item\.raw\?\.referenceNo/);
  assert.match(financeCombinedRoute, /item\.raw\?\.chequePayment\?\.manualVoucherNo/);
  assert.match(financeCombinedRoute, /item\.raw\?\.chequePayment\?\.customer\?\.name/);
});

test("combined payments list sorts newest first and groups linked haji transfers", () => {
  const financeCombinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(financeCombinedRoute, /function compareCombinedPaymentsNewestFirst\(a: any, b: any\): number/);
  assert.match(financeCombinedRoute, /if \(a\.date !== b\.date\) return b\.date\.localeCompare\(a\.date\)/);
  assert.match(financeCombinedRoute, /a\.type === "payment" && b\.type === "haji_transfer" && b\.raw\?\.paymentId === a\.id\) return 1/);
  assert.match(financeCombinedRoute, /b\.type === "payment" && a\.type === "haji_transfer" && a\.raw\?\.paymentId === b\.id\) return -1/);
  assert.match(financeCombinedRoute, /const createdAtDiff = createdAtMs\(b\) - createdAtMs\(a\)/);
  assert.match(financeCombinedRoute, /combined\.sort\(compareCombinedPaymentsNewestFirst\)/);
  assert.doesNotMatch(financeCombinedRoute, /combined\.sort\(\(a, b\) => \{\s+if \(a\.date !== b\.date\) return b\.date\.localeCompare\(a\.date\);\s+return b\.id - a\.id;/);
});

test("city bank balance particulars show transaction source instead of bank account", () => {
  const bankAccountRoute = readFileSync("src/app/api/v1/bank-accounts/[id]/route.ts", "utf8");

  assert.match(bankAccountRoute, /customer: \{ select: \{ name: true \} \}/);
  assert.match(bankAccountRoute, /detail: withRef\(`\$\{source\} — \$\{paymentMethodLabel\(p\.paymentMethod\)\}`, p\.manualVoucherNo\)/);
  assert.match(bankAccountRoute, /detail: withRef\(isB2BOut \? "Transfer to another bank" : isB2BIn \? "Transfer from another bank" : isWithdrawal \? "Cash withdrawn to office" : "Cash deposit", d\.slipNumber\)/);
  assert.match(bankAccountRoute, /detail: withRef\("Cheque deposit", c\.chequeNumber\)/);
});

test("dashboard bank balance only counts movements tied to city bank accounts", () => {
  const treasuryRoute = readFileSync("src/app/api/v1/treasury/route.ts", "utf8");
  const treasuryLedger = readFileSync("src/lib/treasury-ledger.ts", "utf8");

  const hajiFromBankBlock = treasuryRoute.match(/const hajiFromBankRaw = await prisma\.hajiTransfer\.groupBy\(\{[\s\S]*?\n    \}\);/);
  assert.ok(hajiFromBankBlock, "treasury haji bank out block should exist");
  assert.match(hajiFromBankBlock![0], /sourceType: "bank_transfer"/);
  assert.match(hajiFromBankBlock![0], /bankAccountId: \{ not: null \}/);

  const expenseBankBlock = treasuryRoute.match(/const expensesFromBankRaw = await prisma\.expense\.groupBy\(\{[\s\S]*?\n    \}\);/);
  assert.ok(expenseBankBlock, "treasury expense bank out block should exist");
  assert.match(expenseBankBlock![0], /paidFrom: "bank_account"/);
  assert.match(expenseBankBlock![0], /bankAccountId: \{ not: null \}/);

  const withdrawalBankBlock = treasuryRoute.match(/const withdrawalsFromBankRaw = await prisma\.personalWithdrawal\.groupBy\(\{[\s\S]*?\n    \}\);/);
  assert.ok(withdrawalBankBlock, "treasury withdrawal bank out block should exist");
  assert.match(withdrawalBankBlock![0], /sourceType: "bank_account"/);
  assert.match(withdrawalBankBlock![0], /bankAccountId: \{ not: null \}/);

  const depositedChequesBlock = treasuryRoute.match(/const depositedChequesRaw = await prisma\.payment\.groupBy\(\{[\s\S]*?\n    \}\);/);
  assert.ok(depositedChequesBlock, "treasury deposited cheques block should exist");
  assert.match(depositedChequesBlock![0], /bankDepositId: \{ not: null \}/);

  assert.doesNotMatch(treasuryLedger, /hajiDirectPaymentsRaw/);
  assert.match(treasuryLedger, /where: \{ cityId, sourceType: "bank_transfer", bankAccountId: \{ not: null \} \}/);
  assert.match(treasuryLedger, /where: \{ cityId, paidFrom: "bank_account", bankAccountId: \{ not: null \}, deletedAt: null \}/);
});

test("dashboard cheque balance only counts active in-hand payment cheques", () => {
  const treasuryRoute = readFileSync("src/app/api/v1/treasury/route.ts", "utf8");
  const cashPositionRoute = readFileSync("src/app/api/v1/cash-position/route.ts", "utf8");
  const chequesInHandBlock = treasuryRoute.match(/const chequesInHandRaw = await prisma\.payment\.groupBy\(\{[\s\S]*?\n    \}\);/);
  assert.ok(chequesInHandBlock, "treasury cheques in hand block should exist");

  assert.match(chequesInHandBlock![0], /paymentMethod: "cheque"/);
  assert.match(chequesInHandBlock![0], /destination: "our_account"/);
  assert.match(chequesInHandBlock![0], /status: "active"/);
  assert.match(chequesInHandBlock![0], /chequeStatus: "in_hand"/);
  assert.doesNotMatch(treasuryRoute, /openingChequesRaw/);
  assert.doesNotMatch(treasuryRoute, /\[\.\.\.chequesInHandRaw,\s*\.\.\.openingChequesRaw\]/);
  assert.match(cashPositionRoute, /paymentMethod: "cheque", chequeStatus: "in_hand" as any/);
  assert.doesNotMatch(cashPositionRoute, /openingChequeTotal/);
});

test("dashboard cash in office customer receipts show customer and cash received", () => {
  const cashLedgerRoute = readFileSync("src/app/api/v1/treasury/cash-ledger/route.ts", "utf8");
  const cashPaymentBlock = cashLedgerRoute.slice(cashLedgerRoute.indexOf("prisma.payment.findMany"), cashLedgerRoute.indexOf("prisma.hajiTransfer.findMany"));
  const paymentRowBlock = cashLedgerRoute.slice(cashLedgerRoute.indexOf("key: `pay-${p.id}`"), cashLedgerRoute.indexOf("for (const h of hajiOut)"));

  assert.match(cashPaymentBlock, /customer: \{ select: \{ name: true \} \}/);
  assert.match(paymentRowBlock, /type: p\.customer\?\.name \|\| "Customer"/);
  assert.match(paymentRowBlock, /detail: "cash received"/);
  assert.doesNotMatch(paymentRowBlock, /cash to office/i);
});

test("superadmin profit reports handle PCS cartons and scoped financial cash", () => {
  const profitRoute = readFileSync("src/app/api/v1/profit-report/route.ts", "utf8");
  const periodProfitHelper = readFileSync("src/lib/period-profit-report-data.ts", "utf8");
  const financialRoute = readFileSync("src/app/api/v1/financial-reports/route.ts", "utf8");

  assert.match(profitRoute, /function stockQtyToReportCartons/);
  assert.match(profitRoute, /p\.product\?\.unitOfMeasure === "PCS"/);
  assert.match(profitRoute, /num\(p\.qty\) \/ piecesPerCarton/);
  assert.match(profitRoute, /stockQtyToReportCartons\(lp\.totalQty, lp\.product\)/);
  assert.match(periodProfitHelper, /lotPurchases: \{ include: \{ product: true, supplier: true \} \}/);
  assert.match(periodProfitHelper, /stockQtyToReportCartons\(lotProduct\.totalQty, lotProduct\.product\)/);
  assert.match(financialRoute, /where: \{ accountId: \{ in: accountIds \}, \.\.\.\(cityId \? \{ cityId \} : \{\}\) \}/);
});

test("superadmin liability and exchange journals are atomic", () => {
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const agentCreate = readFileSync("src/app/api/v1/agent-payments/route.ts", "utf8");
  const agentUpdate = readFileSync("src/app/api/v1/agent-payments/[id]/route.ts", "utf8");
  const shippingCreate = readFileSync("src/app/api/v1/shipping-line-payments/route.ts", "utf8");
  const shippingUpdate = readFileSync("src/app/api/v1/shipping-line-payments/[id]/route.ts", "utf8");
  const intermediaryDepositCreate = readFileSync("src/app/api/v1/intermediaries/[id]/deposits/route.ts", "utf8");
  const exchangeCreate = readFileSync("src/app/api/v1/intermediaries/[id]/exchanges/route.ts", "utf8");
  const exchangeUpdate = readFileSync("src/app/api/v1/intermediary-exchanges/[id]/route.ts", "utf8");

  assert.match(accounting, /journalAgentPaid\([\s\S]*db: DbClient = prisma/);
  assert.match(accounting, /journalShippingLinePayment\([\s\S]*db: DbClient = prisma/);
  assert.match(accounting, /journalIntermediaryExchange\([\s\S]*db: DbClient = prisma/);
  assert.match(accounting, /journalIntermediaryDeposit\([\s\S]*db: DbClient = prisma/);
  assert.match(agentCreate, /await journalAgentPaid\([\s\S]*,\s*tx\);/);
  assert.match(agentUpdate, /await reverseJournalEntries\(`AGENTPAY-\$\{id\}`, user\.userId, tx\)/);
  assert.match(agentUpdate, /await journalAgentPaid\([\s\S]*,\s*tx\);/);
  assert.match(shippingCreate, /await journalShippingLinePayment\([\s\S]*,\s*tx\);/);
  assert.match(shippingUpdate, /await reverseJournalEntries\(`SLPAY-\$\{id\}`, user\.userId, tx\)/);
  assert.match(shippingUpdate, /await journalShippingLinePayment\([\s\S]*,\s*tx\);/);
  assert.match(intermediaryDepositCreate, /await journalIntermediaryDeposit\([\s\S]*,\s*tx\);/);
  assert.match(exchangeCreate, /await journalIntermediaryExchange\([\s\S]*,\s*tx\);/);
  assert.match(exchangeUpdate, /await journalIntermediaryExchange\([\s\S]*,\s*tx\);/);
  assert.doesNotMatch(agentCreate, /catch \(e\) \{ console\.error\("Journal entry error:/);
  assert.doesNotMatch(shippingCreate, /catch \(je\) \{ console\.error\("Journal \(shipping line payment\):/);
});

test("country fallback rates and intermediary FIFO costing are wired", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260808090000_country_fallback_fifo_rates/migration.sql", "utf8");
  const fallbackRoute = readFileSync("src/app/api/v1/country-fallback-rates/route.ts", "utf8");
  const fifo = readFileSync("src/lib/intermediary-usd-fifo.ts", "utf8");
  const settlementValidation = readFileSync("src/lib/settlement-validation.ts", "utf8");
  const supplierCreate = readFileSync("src/app/api/v1/supplier-payments/route.ts", "utf8");
  const supplierUpdate = readFileSync("src/app/api/v1/supplier-payments/[id]/route.ts", "utf8");
  const shippingCreate = readFileSync("src/app/api/v1/shipping-line-payments/route.ts", "utf8");
  const shippingUpdate = readFileSync("src/app/api/v1/shipping-line-payments/[id]/route.ts", "utf8");
  const exchangeCreate = readFileSync("src/app/api/v1/intermediaries/[id]/exchanges/route.ts", "utf8");
  const exchangeUpdate = readFileSync("src/app/api/v1/intermediary-exchanges/[id]/route.ts", "utf8");
  const profitRoute = readFileSync("src/app/api/v1/profit-report/route.ts", "utf8");
  const settingsPage = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");

  assert.match(schema, /model CountryFallbackExchangeRate/);
  assert.match(schema, /model IntermediaryUsdCostLayer/);
  assert.match(schema, /model IntermediaryUsdCostUsage/);
  assert.match(migration, /CREATE TABLE "country_fallback_exchange_rates"/);
  assert.match(migration, /country_fallback_rates_country_currency_date_key/);
  assert.match(migration, /country_fallback_rates_active_idx/);
  assert.doesNotMatch(migration, /country_fallback_exchange_rates_country_id_from_currency_id_to_currency_id/);
  assert.match(migration, /CREATE TABLE "intermediary_usd_cost_layers"/);
  assert.match(migration, /CREATE TABLE "intermediary_usd_cost_usages"/);
  assert.match(fallbackRoute, /countryFallbackExchangeRate\.upsert/);
  assert.match(settingsPage, /exchange_rates/);
  assert.match(settingsPage, /CountryFallbackRatesTab/);
  assert.match(fifo, /consumeIntermediaryUsdFifo/);
  assert.match(fifo, /orderBy: \[\{ acquiredDate: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(fifo, /reverseIntermediaryUsdCostUsages/);
  assert.match(fifo, /isFallbackRate: true/);
  assert.match(settlementValidation, /excludeSupplierPaymentId/);
  assert.match(supplierCreate, /consumeIntermediaryUsdFifo\(/);
  assert.match(supplierUpdate, /reverseIntermediaryUsdCostUsages\(\{ supplierPaymentId: id \}/);
  assert.match(shippingCreate, /getIntermediaryBalances\(resolvedIntermediaryId\)/);
  assert.match(shippingCreate, /consumeIntermediaryUsdFifo\(/);
  assert.match(shippingUpdate, /excludeShippingLinePaymentId: id/);
  assert.match(shippingUpdate, /reverseIntermediaryUsdCostUsages\(\{ shippingLinePaymentId: id \}/);
  assert.match(exchangeCreate, /createIntermediaryUsdLayerFromExchange\(/);
  assert.match(exchangeUpdate, /assertIntermediaryUsdLayerUnused\("intermediary_exchange", id\)/);
  assert.match(profitRoute, /getCountryFallbackRateToPkr/);
  assert.match(profitRoute, /purchasePkrFromLinkedSupplierPayments/);
});

test("cheque register paginates server-side after cheque and status filters", () => {
  const chequesPage = readFileSync("src/app/(dashboard)/cheques/page.tsx", "utf8");
  const combinedRoute = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");

  assert.match(chequesPage, /type: "payment", page, limit: DEFAULT_LIST_PAGE_SIZE, payment_method: "cheque"/);
  assert.match(chequesPage, /if \(tab !== "all"\) params\.cheque_status = tab/);
  assert.match(chequesPage, /useEffect\(\(\) => \{ setPage\(1\); \}, \[tab\]\)/);
  assert.match(combinedRoute, /const paymentMethodFilter = sp\.get\("payment_method"\)/);
  assert.match(combinedRoute, /\.\.\.\(paymentMethodFilter \? \{ paymentMethod: paymentMethodFilter \} : \{\}\)/);
  assert.match(combinedRoute, /\.\.\.\(chequeStatusFilter \? \{ chequeStatus: chequeStatusFilter \} : \{\}\)/);
});

test("pakistan inter funds transfer keeps compact rows with standard pagination", () => {
  const bankDepositsPage = readFileSync("src/app/(dashboard)/bank-deposits/page.tsx", "utf8");

  assert.match(bankDepositsPage, /const params: any = \{ page, limit: DEFAULT_LIST_PAGE_SIZE \}/);
  assert.match(bankDepositsPage, /pageSize: DEFAULT_LIST_PAGE_SIZE/);
  assert.match(bankDepositsPage, /className="space-y-2"/);
  assert.match(bankDepositsPage, /px-3 py-2/);
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

test("customer portal access is isolated from admin auth and ledger scoped", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const customerModel = modelBlock("Customer");
  const customerRoute = readFileSync("src/app/api/v1/customers/route.ts", "utf8");
  const customerUpdateRoute = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
  const portalAuth = readFileSync("src/lib/customer-portal-auth.ts", "utf8");
  const portalLogin = readFileSync("src/app/api/v1/customer-portal/login/route.ts", "utf8");
  const portalLedger = readFileSync("src/app/api/v1/customer-portal/ledger/route.ts", "utf8");
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const migration = readFileSync("prisma/migrations/20260729100000_customer_portal_access/migration.sql", "utf8");

  assert.match(customerModel, /portalAccessEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(customerModel, /portalUsername\s+String\?/);
  assert.match(customerModel, /portalPasswordHash\s+String\?/);
  assert.match(migration, /portal_access_enabled/);
  assert.match(migration, /portal_username/);
  assert.match(migration, /WHERE "portal_username" IS NOT NULL/);
  assert.doesNotMatch(schema, /role:\s+"customer"/);

  assert.match(portalAuth, /CUSTOMER_PORTAL_COOKIE = "customer_portal_token"/);
  assert.match(portalAuth, /type: "customer_portal"/);
  assert.match(portalAuth, /portalAccessEnabled: true/);
  assert.match(portalLogin, /comparePassword/);
  assert.match(portalLogin, /setCustomerPortalCookie/);
  assert.match(portalLedger, /getCustomerPortalCustomer/);
  assert.match(portalLedger, /customerId: customer\.id/);
  assert.doesNotMatch(portalLedger, /context\.params\.id/);

  assert.match(customerRoute, /hashPassword\(portalPassword\)/);
  assert.match(customerUpdateRoute, /hashPassword\(data\.portalPassword\)/);
  assert.match(customersPage, /Portal Access/);
  assert.match(customersPage, /portalAccessEnabled/);
  assert.match(customersPage, /Portal Username \*/);
  assert.match(customersPage, /Portal Password \*/);
  assert.match(customersPage, /credentials are not stored offline/);
});

test("customer portal can print scoped ledger PDF", () => {
  const portalPage = readFileSync("src/app/customer-portal/page.tsx", "utf8");
  const portalLedger = readFileSync("src/app/api/v1/customer-portal/ledger/route.ts", "utf8");

  assert.match(portalPage, /printCustomerLedgerStatement/);
  assert.match(portalPage, /const printPdf = async \(\) =>/);
  assert.match(portalPage, /fetchLedgerData\(\)/);
  assert.match(portalPage, /Print \/ PDF/);
  assert.match(portalPage, /dateFrom: fromDate \|\| undefined/);
  assert.match(portalPage, /dateTo: toDate \|\| undefined/);
  assert.match(portalLedger, /getCustomerPortalCustomer/);
  assert.match(portalLedger, /customerId: customer\.id/);
  assert.doesNotMatch(portalPage, /\/api\/v1\/customers\/\$\{/);
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
  assert.match(cityTransferCreate, /pg_advisory_xact_lock\(31001, \$\{parsedFromGodownId \* 100000 \+ parsedProductId\}::int\)/);
  assert.match(cityTransferCreate, /si\.lot_id = lcd\.lot_id/);
  assert.match(cityTransferCreate, /ORDER BY l\.lot_date ASC, l\.id ASC/);
  assert.doesNotMatch(cityTransferCreate, /pg_advisory_xact_lock\(\$\{31001\},/);
  assert.match(cityTransferApprove, /pg_advisory_xact_lock/);
  assert.match(cityTransferApprove, /pg_advisory_xact_lock\(31001, \$\{transfer\.fromGodownId \* 100000 \+ transfer\.productId\}::int\)/);
  assert.match(cityTransferApprove, /ct\.id <> \$\{id\}/);
  assert.match(cityTransferApprove, /lotId: effectiveLotId/);
  assert.doesNotMatch(cityTransferApprove, /pg_advisory_xact_lock\(\$\{31001\},/);
  assert.match(cityTransferApprove, /SENDER_INSUFFICIENT_STOCK/);
  assert.doesNotMatch(withdrawalsCreate, /journalWithdrawal\(/);
  assert.doesNotMatch(withdrawalsApprove, /journalWithdrawal\(/);
  assert.doesNotMatch(withdrawalsApprove, /hajiTransfer\.create\(/);
  assert.match(withdrawalsApprove, /approvedAt:\s*now/);
  assert.match(withdrawalsEdit, /Cannot edit an approved withdrawal/);
  assert.match(withdrawalsEdit, /Cannot delete an approved withdrawal/);
  assert.match(withdrawalCleanupMigration, /pw\."approved_at" IS NULL/);
  assert.match(customerRoute, /createCustomerSchema\.safeParse/);
  assert.match(adminCleanupRoute, /REQUIRED_CONFIRM_PHRASE/);
  assert.match(adminCleanupRoute, /timingSafeEqual/);
  assert.match(saleRoute, /CASE WHEN current_number >= 9999 THEN 1 ELSE current_number \+ 1 END/);
  assert.match(stockActivation, /journalSaleCOGS/);
});

test("city transfer send modal uses available source godowns", () => {
  const cityTransfersPage = readFileSync("src/app/(dashboard)/city-transfers/page.tsx", "utf8");

  assert.match(cityTransfersPage, /apiCall\("\/api\/v1\/inventory\/godown-stock"\)/);
  assert.match(cityTransfersPage, /const sourceGodownOptions = useMemo/);
  assert.match(cityTransfersPage, /Number\(row\.available \|\| 0\)/);
  assert.match(cityTransfersPage, /Source Godown \*/);
  assert.match(cityTransfersPage, /getSourceGodownAvailable\(g\.id\)/);
  assert.match(cityTransfersPage, /No source godown has available stock for this product\./);
});

test("investor attribution phase 1 foundation reconciles to existing profit report", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811100000_investor_attribution_phase1/migration.sql", "utf8");
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const periodProfitHelper = readFileSync("src/lib/period-profit-report-data.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(schema, /model InvestmentParticipant/);
  assert.match(schema, /model InvestmentCapitalEvent/);
  assert.match(schema, /model ProfitAttributionPeriod/);
  assert.match(schema, /model ProfitAttributionLine/);
  assert.match(schema, /model InvestorResidualAttribution/);
  assert.match(schema, /model ExchangeRate/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "profit_attribution_periods"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "exchange_rates"/);

  assert.match(periodProfitHelper, /export async function buildPeriodProfitReportData/);
  assert.match(attributionRoute, /buildPeriodProfitReportData/);
  assert.match(attributionRoute, /buildInvestorAttributionPreview/);
  assert.match(attributionRoute, /phase: "preview_only"/);
  assert.doesNotMatch(attributionRoute, /journalEntry\.(create|createMany|update|delete)/);
  assert.doesNotMatch(attributionRoute, /payment\.(create|createMany|update|delete)/);
  assert.doesNotMatch(attributionRoute, /bankDeposit\.(create|createMany|update|delete)/);

  assert.match(investorsPage, /Investor Profit\/Loss Attribution/);
  assert.match(investorsPage, /Preview only/);
  assert.match(investorsPage, /Finalize Preview \/ Dry Run/);
});

test("investor attribution phase 1.1 keeps participant management separate from accounting postings", () => {
  const phaseOneOneMigration = readFileSync("prisma/migrations/20260811110000_investor_attribution_phase1_1/migration.sql", "utf8");
  const participantsRoute = readFileSync("src/app/api/v1/investment-participants/route.ts", "utf8");
  const capitalEventsRoute = readFileSync("src/app/api/v1/investment-participants/[id]/capital-events/route.ts", "utf8");
  const shareEventsRoute = readFileSync("src/app/api/v1/investment-participants/[id]/profit-share-events/route.ts", "utf8");
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const attributionEngine = readFileSync("src/lib/investor-attribution.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");
  const participantsManagementCode = participantsRoute.replace(/journalTransactionId/g, "");

  assert.match(schema, /model InvestmentProfitShareEvent/);
  assert.match(schema, /full_exit/);
  assert.match(schema, /managerProfitSharePercent\s+Decimal\s+@map\("manager_profit_share_percent"\) @db\.Decimal\(9, 6\)/);
  assert.match(schema, /managerOwnCapitalProfitPkr\s+Decimal\s+@map\("manager_own_capital_profit_pkr"\)/);
  assert.match(phaseOneOneMigration, /CREATE TABLE IF NOT EXISTS "investment_profit_share_events"/);
  assert.match(phaseOneOneMigration, /ALTER COLUMN "investor_profit_share_percent" TYPE DECIMAL\(9, 6\)/);
  assert.match(phaseOneOneMigration, /ADD COLUMN IF NOT EXISTS "manager_profit_share_percent"/);

  assert.match(participantsRoute, /user\.role !== "super_admin"/);
  assert.match(participantsRoute, /investmentParticipant\.create/);
  assert.match(participantsRoute, /investmentProfitShareEvent\.create/);
  assert.match(participantsRoute, /investmentCapitalEvent\.create/);
  assert.match(capitalEventsRoute, /"opening", "capital_contribution", "capital_withdrawal", "profit_reinvestment", "full_exit"/);
  assert.match(capitalEventsRoute, /hasFinalizedAttributionOnOrAfter/);
  assert.match(capitalEventsRoute, /currentParticipantCapitalPkr/);
  assert.match(capitalEventsRoute, /eventType === "full_exit"/);
  assert.match(shareEventsRoute, /assertProfitShareTotal/);
  assert.match(shareEventsRoute, /hasFinalizedAttributionOnOrAfter/);

  assert.match(attributionRoute, /loadExplicitProfitShareEvents/);
  assert.match(attributionRoute, /capitalSourceLabel/);
  assert.match(attributionRoute, /Derived from legacy investor transactions/);
  assert.match(attributionRoute, /findMissingRequiredRates/);
  assert.match(attributionRoute, /customer collection/);
  assert.match(attributionRoute, /supplier payment/);
  assert.match(attributionRoute, /shipping payment/);
  assert.match(attributionRoute, /intermediary deposit/);
  assert.match(attributionEngine, /totalManagerOwnCapitalProfitPkr/);
  assert.match(attributionEngine, /totalManagerSharePkr/);

  assert.doesNotMatch(participantsManagementCode, /journal[A-Z]/);
  assert.doesNotMatch(capitalEventsRoute, /journal[A-Z]/);
  assert.doesNotMatch(shareEventsRoute, /journal[A-Z]/);
  assert.doesNotMatch(participantsRoute, /journalEntry/);
  assert.doesNotMatch(capitalEventsRoute, /journalEntry/);
  assert.doesNotMatch(shareEventsRoute, /journalEntry/);

  assert.match(investorsPage, /Participation Setup/);
  assert.match(investorsPage, /New participant/);
  assert.match(investorsPage, /Capital event/);
  assert.match(investorsPage, /Profit-share change/);
  assert.match(investorsPage, /Manager Own Capital/);
  assert.match(investorsPage, /Manager Split Share/);
  assert.match(investorsPage, /Missing FX rates/);
  assert.match(investorsPage, /Participation segments/);
});

test("profit report helper does not query impossible null expense lot ids", () => {
  const profitReportRoute = readFileSync("src/app/api/v1/profit-report/route.ts", "utf8");
  const periodProfitHelper = readFileSync("src/lib/period-profit-report-data.ts", "utf8");

  assert.doesNotMatch(profitReportRoute, /lotId:\s*null/);
  assert.doesNotMatch(periodProfitHelper, /lotId:\s*null/);
});

test("investor attribution follows financial report recognition without collection eligibility", () => {
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const attributionEngine = readFileSync("src/lib/investor-attribution.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");
  const cleanupMigration = readFileSync("prisma/migrations/20260811120000_remove_collection_based_investor_eligibility/migration.sql", "utf8");

  assert.match(attributionRoute, /buildReadiness/);
  assert.match(attributionRoute, /BLOCKED_RECONCILIATION/);
  assert.match(attributionRoute, /BLOCKED_MISSING_FX/);
  assert.match(attributionRoute, /BLOCKED_DATA_INTEGRITY/);
  assert.match(attributionRoute, /BLOCKED_UNRESOLVED_LEGACY_CAPITAL/);
  assert.match(attributionRoute, /finalizationButtonEnabled: false/);
  assert.match(investorsPage, /Readiness blockers/);
  assert.match(cleanupMigration, /DROP COLUMN IF EXISTS "distribution_eligible_profit_pkr"/);
  assert.match(cleanupMigration, /DROP COLUMN IF EXISTS "pending_collection_profit_pkr"/);

  assert.doesNotMatch(attributionRoute, /journal[A-Z]/);
  assert.doesNotMatch(attributionRoute, /journalEntry/);
  assert.doesNotMatch(attributionRoute, /allocateCollectionEligibility/);
  assert.doesNotMatch(attributionRoute, /collectionStrategy/);
  assert.doesNotMatch(attributionRoute, /unallocatedCustomerReceipts/);
  assert.doesNotMatch(attributionEngine, /distributionEligibleProfit/);
  assert.doesNotMatch(attributionEngine, /pendingCollectionProfit/);
  assert.doesNotMatch(investorsPage, /Eligible Profit/);
  assert.doesNotMatch(investorsPage, /Pending Profit/);
  assert.doesNotMatch(investorsPage, /Allocated Collections/);
  assert.doesNotMatch(investorsPage, /Unallocated Receipts/);
});

test("investor attribution legacy capital review is read-only", () => {
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const legacyReview = readFileSync("src/lib/legacy-investor-capital-review.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(attributionRoute, /loadLegacyCapitalReview/);
  assert.match(attributionRoute, /buildLegacyInvestorCapitalReview/);
  assert.match(attributionRoute, /legacyCapitalReview/);
  assert.match(legacyReview, /Derived from legacy investor transactions/);
  assert.match(legacyReview, /proposedOpeningCapitalPkr/);
  assert.match(legacyReview, /capitalEventCandidates/);
  assert.match(legacyReview, /ambiguities/);
  assert.match(investorsPage, /Legacy capital review/);
  assert.match(investorsPage, /Read-only backfill preview/);

  assert.doesNotMatch(attributionRoute, /investmentCapitalEvent\.create/);
  assert.doesNotMatch(attributionRoute, /investmentParticipant\.create/);
  assert.doesNotMatch(attributionRoute, /journalEntry/);
  assert.doesNotMatch(legacyReview, /\.create\(/);
  assert.doesNotMatch(legacyReview, /\.update\(/);
  assert.doesNotMatch(legacyReview, /\.delete\(/);
});

test("investor attribution phase 1.3 historical pool tracking is preview-only", () => {
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const poolPreview = readFileSync("src/lib/historical-pool-attribution.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(attributionRoute, /buildHistoricalPoolPreview/);
  assert.match(attributionRoute, /loadHistoricalPoolTransactions/);
  assert.match(attributionRoute, /historicalPoolPreview/);
  assert.match(poolPreview, /stablePoolId/);
  assert.match(poolPreview, /originalPoolDate/);
  assert.match(poolPreview, /fx_gain_loss/);
  assert.match(poolPreview, /Exited investor residual gain\/loss assumed by manager/);
  assert.match(investorsPage, /Historical pool tracking/);
  assert.match(investorsPage, /transactions stay attached to their original participation pool/);
  assert.match(investorsPage, /Residual manager assumptions/);

  assert.doesNotMatch(attributionRoute, /journalEntry/);
  assert.doesNotMatch(poolPreview, /\.create\(/);
  assert.doesNotMatch(poolPreview, /\.update\(/);
  assert.doesNotMatch(poolPreview, /\.delete\(/);
});

test("investor attribution phase 2.2 controlled finalization is atomic and attribution-only", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260813100000_controlled_investor_finalization/migration.sql", "utf8");
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const investorsPage = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(schema, /enum InvestorAttributionLedgerCategory/);
  assert.match(schema, /investor_profit/);
  assert.match(schema, /investor_capital_loss/);
  assert.match(schema, /manager_own_capital/);
  assert.match(schema, /manager_profit_share/);
  assert.match(schema, /manager_residual/);
  assert.match(schema, /model InvestorAttributionLedgerEntry/);
  assert.match(schema, /snapshotJson\s+Json\?/);
  assert.match(schema, /postingSimulationJson\s+Json\?/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "snapshot_json"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "investor_attribution_ledger_entries"/);
  assert.match(migration, /investor_attr_ledger_period_ref_type_key/);

  assert.match(attributionRoute, /action === "finalize"/);
  assert.match(attributionRoute, /isInvestorFinalizationEnabled/);
  assert.match(attributionRoute, /FEATURE_DISABLED/);
  assert.match(attributionRoute, /confirmation !== "FINALIZE"/);
  assert.match(attributionRoute, /assertFinalizationEligible/);
  assert.match(attributionRoute, /prisma\.\$transaction/);
  assert.match(attributionRoute, /pg_advisory_xact_lock/);
  assert.match(attributionRoute, /ALREADY_FINALIZED/);
  assert.match(attributionRoute, /profitAttributionPeriod\.create/);
  assert.match(attributionRoute, /profitAttributionLine\.createMany/);
  assert.match(attributionRoute, /investorResidualAttribution\.createMany/);
  assert.match(attributionRoute, /investorAttributionLedgerEntry\.createMany/);
  assert.match(attributionRoute, /entryType: "finalization"/);
  assert.match(attributionRoute, /action === "reverse"/);
  assert.match(attributionRoute, /entryType: "reversal"/);
  assert.match(attributionRoute, /reverse_\$\{entry\.postingType\}/);
  assert.match(attributionRoute, /Only finalized investor attribution periods can be reversed/);
  assert.match(investorsPage, /Finalize Period/);
  assert.match(investorsPage, /Type FINALIZE/);

  assert.doesNotMatch(attributionRoute, /journalEntry\.(create|createMany|update|delete)/);
  assert.doesNotMatch(attributionRoute, /bankDeposit\.(create|createMany|update|delete)/);
  assert.doesNotMatch(attributionRoute, /payment\.(create|createMany|update|delete)/);
  assert.doesNotMatch(attributionRoute, /cash|bank settlement/i);
});
