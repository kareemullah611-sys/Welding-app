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
  const paymentUpdateRoute = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");
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
  assert.match(paymentUpdateRoute, /const linkedHajiTransfer = await tx\.hajiTransfer\.findUnique/);
  assert.match(paymentUpdateRoute, /if \(nextDestination === "haji"\)/);
  assert.match(paymentUpdateRoute, /referenceNo: nextManualVoucherNo/);
  assert.match(paymentUpdateRoute, /linkedHajiTransfer\s+\?\s+await tx\.hajiTransfer\.update/);
  assert.match(paymentUpdateRoute, /:\s+await tx\.hajiTransfer\.create/);
  assert.match(paymentUpdateRoute, /journalHajiTransfer\(/);
  assert.match(paymentUpdateRoute, /else if \(linkedHajiTransfer\)/);
  assert.match(paymentUpdateRoute, /await tx\.hajiTransfer\.delete\(\{ where: \{ id: linkedHajiTransfer\.id \} \}\)/);
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
  assert.match(paymentsPage, /setLatestCreatedEntry\(buildLatestPaymentEntrySummary\(createType, body, formSnapshot, currencies, lots/);
  assert.match(paymentsPage, /setLatestCreatedEntry\(buildLatestPaymentEntrySummaryFromRow\(items\.find\(\(item: any\) => item\.type === type\) \|\| items\[0\]/);
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
  assert.match(salesPage, /const \[latestCreatedSale, setLatestCreatedSale\] = useState<LatestSaleSummary \| null>\(null\)/);
  assert.match(salesPage, /setLatestCreatedSale\(buildLatestSaleSummary\(/);
  assert.match(salesPage, /setLatestCreatedSale\(buildLatestSaleSummaryFromRow\(sales\[0\]/);
  assert.match(salesPage, /\{latestCreatedSale && \(/);
  assert.match(salesPage, /latestCreatedSale\.meta\.join\(" · "\)/);
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
  assert.doesNotMatch(quickformFooter, /bg-\[rgba/);
  assert.match(modalActionsFooter, /sticky bottom-0/);
  assert.match(modalActionsFooter, /bg-white/);
  assert.doesNotMatch(modalActionsFooter, /bg-\[rgba/);
});

test("quickform and modal fields show focus highlight on every edge", () => {
  const globals = readFileSync("src/app/globals.css", "utf8");
  const focusRule = globals.slice(globals.indexOf(".quickform-embed .input-field:focus,"), globals.indexOf(".quickform-embed label {"));

  assert.match(focusRule, /\.quickform-embed \.input-field:focus/);
  assert.match(focusRule, /\.modal-sheet-body \.input-field:focus/);
  assert.match(focusRule, /\[data-radix-dialog-content\] \.select-field:focus/);
  assert.match(focusRule, /box-shadow: inset 0 0 0 2px #6b0f1a/);
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
  assert.match(saleCorrectRoute, /normalizedItems\.push\(\.\.\.allocatedItems\)/);
  assert.match(saleCorrectRoute, /const newItemData = normalizedItems\.map/);
  assert.match(salesPage, /updateItem\(idx, "lotId"/);
  assert.match(salesPage, /isSaleItemLotLocked\(item\)/);
  assert.match(salesPage, /const \[correctGodownId, setCorrectGodownId\] = useState\(0\)/);
  assert.match(salesPage, /const \[correctSaleDate, setCorrectSaleDate\] = useState\(""\)/);
  assert.match(salesPage, /setCorrectGodownId\(saleGodownId\)/);
  assert.match(salesPage, /setCorrectSaleDate\(sale\.saleDate \|\| ""\)/);
  assert.match(salesPage, /value=\{correctSaleDate\}/);
  assert.match(salesPage, /body: \{ saleDate: correctSaleDate, godownId: correctGodownId, items: expandedItems, reason: correctReason \}/);
  assert.match(salesPage, /lotOptionsForItem = \(item: any, includeOwnCorrectQty = false\)/);
  assert.match(salesPage, /filter\(\(lot: any\) => Number\(lot\.available \|\| 0\) \+ \(includeOwnCorrectQty \? ownCorrectItemQty\(item, Number\(lot\.lotId\)\) : 0\) > 0\)/);
  assert.match(salesPage, /\.\.\.\(field === "productId" \? \{ lotId: 0, remainingLotId: 0 \} : \{\}\)/);
  assert.match(salesPage, /\.\.\.\(field === "lotId" \? \{ remainingLotId: 0 \} : \{\}\)/);
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
  assert.match(salesRoute, /availableLots: await getAvailableLotsForProduct\(cityId, user\.countryId!, godownId, item\.productId\)/);
  assert.match(godownStockRoute, /lotBreakdown/);
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
  const getMetricsStart = cityLotAssignment.indexOf("export async function getCitySoldMetrics");
  const getMetricsEnd = cityLotAssignment.indexOf("export async function buildCityLotAssignmentDetail", getMetricsStart);
  const getMetricsBlock = cityLotAssignment.slice(getMetricsStart, getMetricsEnd);

  assert.ok(getMetricsStart >= 0, "city sold metrics helper should exist");
  assert.match(cityLotAssignment, /import \{ aggregateLotSalesMetrics, aggregateSingleLotSalesMetrics, fetchLotSalesForMetrics \}/);
  assert.match(getMetricsBlock, /aggregateLotSalesMetrics\(sales\)\.get\(lotId\)/);
  assert.doesNotMatch(getMetricsBlock, /aggregateSingleLotSalesMetrics\(sales\)/);
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

test("customer ledger sale details stay complete with at-rate display across table and PDF", () => {
  const customerRoute = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  const customersPage = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const ledgerExport = readFileSync("src/lib/ledger-export.ts", "utf8");

  assert.match(customerRoute, /formatCustomerLedgerSaleDetail/);
  assert.match(customerRoute, /formatCustomerLedgerSaleRate/);
  assert.match(exportRoute, /formatCustomerLedgerSaleDetail/);
  assert.match(exportRoute, /formatCustomerLedgerSaleRate/);
  assert.match(customersPage, /function compactCustomerLedgerDetail\(entry/);
  assert.doesNotMatch(customersPage, /slice\(0,\s*40\)/);
  assert.match(customersPage, /whitespace-normal/);
  assert.match(customersPage, /break-words/);
  assert.match(ledgerExport, /overflow-wrap: anywhere/);
  assert.match(ledgerExport, /white-space: normal/);
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
  assert.match(paymentsPage, /\{t\("lot"\)\}[\s\S]*\{t\("notes"\)\}/);
  assert.doesNotMatch(paymentsPage, /\{t\("lot"\)\}[\s\S]{0,700}\{!isEmbed && \(/);
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
  assert.match(paymentsPage, /e\.currentTarget\.blur\(\)/);
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

test("dashboard cash in office customer receipts show customer and cash received", () => {
  const cashLedgerRoute = readFileSync("src/app/api/v1/treasury/cash-ledger/route.ts", "utf8");
  const cashPaymentBlock = cashLedgerRoute.slice(cashLedgerRoute.indexOf("prisma.payment.findMany"), cashLedgerRoute.indexOf("prisma.hajiTransfer.findMany"));
  const paymentRowBlock = cashLedgerRoute.slice(cashLedgerRoute.indexOf("key: `pay-${p.id}`"), cashLedgerRoute.indexOf("for (const h of hajiOut)"));

  assert.match(cashPaymentBlock, /customer: \{ select: \{ name: true \} \}/);
  assert.match(paymentRowBlock, /type: p\.customer\?\.name \|\| "Customer"/);
  assert.match(paymentRowBlock, /detail: "cash received"/);
  assert.doesNotMatch(paymentRowBlock, /cash to office/i);
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
