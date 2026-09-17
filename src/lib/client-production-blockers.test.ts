import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("sale discounts are locked and capped by remaining sale value", () => {
  const route = read("src/app/api/v1/sales/[id]/discount/route.ts");
  assert.match(route, /lockSaleDiscount/);
  assert.match(route, /discountAmount[^\n]+Number\(lockedSale\.totalAmount\)/);
  assert.match(route, /tx\.sale\.update/);
});

test("all audited stock mutations use the shared godown-product lock", () => {
  const paths = [
    "src/app/api/v1/sales/route.ts",
    "src/app/api/v1/sales/[id]/correct/route.ts",
    "src/app/api/v1/godowns/transfers/route.ts",
    "src/app/api/v1/lots/[id]/godown-allocate/route.ts",
    "src/lib/stock-activation.ts",
  ];
  for (const path of paths) assert.match(read(path), /lockGodownProductStock/);
  assert.match(read(paths[3]), /prisma\.\$transaction/);
  const activation = read(paths[4]);
  assert.match(activation, /journalSaleCOGSForLots\([\s\S]*, tx\)/);
  assert.doesNotMatch(activation, /Failed to post deferred COGS/);
});

test("intermediary FIFO consumption locks the intermediary pool", () => {
  const fifo = read("src/lib/intermediary-usd-fifo.ts");
  assert.match(fifo, /lockIntermediaryUsdFifo/);
  assert.ok(fifo.indexOf("lockIntermediaryUsdFifo") < fifo.indexOf("intermediaryUsdCostLayer.findMany"));
});

test("lot costs allocate sold shares without charging an operating-expense account", () => {
  const accounting = read("src/lib/accounting.ts");
  const block = accounting.slice(accounting.indexOf("export async function journalLotCost"), accounting.indexOf("// AGENT PAID"));
  assert.match(block, /getInventoryAccountId/);
  assert.match(block, /getCOGSAccountId/);
  assert.match(block, /getHistoricalStockAdjustmentAccountId/);
  assert.match(block, /calculateLateLotCostAllocation/);
  assert.match(block, /product\.productName/);
  assert.doesNotMatch(block, /getExpenseAccountId/);
});

test("lot cost edits and deletes post current allocation deltas instead of reversing stale allocations", () => {
  const route = read("src/app/api/v1/lot-costs/[id]/route.ts");
  assert.doesNotMatch(route, /reverseJournalEntries/);
  assert.match(route, /amountPkrDelta/);
  assert.match(route, /amountPkr: amountPkrDelta/);
  assert.match(route, /amountPkr: -currentAmountPkr/);
  assert.match(route, /journalVersion: \{ increment: 1 \}/);
  assert.match(route, /recognitionDate: new Date\(\)/);
});

test("post-sale purchase corrections use immutable delta journals", () => {
  const lotRoute = read("src/app/api/v1/lots/[id]/route.ts");
  const purchaseRoute = read("src/app/api/v1/lot-purchases/[id]/route.ts");
  for (const route of [lotRoute, purchaseRoute]) {
    assert.match(route, /calculateLotProductLandedCostsForLot/);
    assert.match(route, /journalLotPurchaseCorrection/);
  }
  const purchaseUpdateBlock = purchaseRoute.slice(0, purchaseRoute.indexOf("// DELETE"));
  assert.doesNotMatch(purchaseUpdateBlock, /reverseJournalEntries/);
  assert.doesNotMatch(purchaseUpdateBlock, /journalLotPurchase\(/);
});

test("visible profit report includes expenses and converts stock units to cartons", () => {
  const route = read("src/app/api/v1/profit-report/route.ts");
  const helper = read("src/lib/period-profit-report-data.ts");
  assert.doesNotMatch(route, /_sum:\s*\{\s*amount:\s*null/);
  assert.match(route, /stockQtyToReportCartons\(item\.qty, item\.product\)/);
  assert.match(helper, /stockQtyToReportCartons\(item\.qty, item\.product\)/);
});

test("investor finalization blocks overlaps and reversal after entitlement consumption", () => {
  const route = read("src/app/api/v1/investor-attribution/route.ts");
  const dryRun = read("src/lib/investor-finalization-dry-run.ts");
  const migration = read("prisma/migrations/20260901090000_client_production_blockers/migration.sql");
  assert.match(route, /investor-finalization-timeline/);
  assert.match(route, /OVERLAPPING_FINALIZATION/);
  assert.match(route, /FINALIZATION_ENTITLEMENT_CONSUMED/);
  assert.match(route, /findSourceChangesAfterFinalization/);
  assert.match(route, /sourceChangesAfterFinalization/);
  assert.match(dryRun, /BLOCKED_OVERLAPPING_FINALIZATION/);
  assert.match(migration, /profit_attribution_periods_no_finalized_overlap/);
});

test("investor ledger classification and missing shares use explicit values", () => {
  const actions = read("src/lib/investor-participant-actions.ts");
  const attribution = read("src/lib/investor-attribution.ts");
  assert.match(actions, /manager_own_capital_profit/);
  assert.match(actions, /manager_own_capital_loss/);
  assert.doesNotMatch(actions, /debitAccount[^\n]+manager capital/i);
  assert.match(attribution, /has no explicit investor profit-share percentage/);
});

test("financial year and lot rate changes share serialization locks with posting and finalization", () => {
  const accounting = read("src/lib/accounting.ts");
  const lotRate = read("src/app/api/v1/lots/[id]/pkr-rate/route.ts");
  assert.match(accounting, /financial-year:\$\{matchingYear\.id\}/);
  assert.match(lotRate, /investor-finalization-timeline/);
});

test("payment FX equivalents are derived on the server", () => {
  const route = read("src/app/api/v1/payments/route.ts");
  const fx = read("src/lib/payment-fx.ts");
  assert.match(route, /normalizePaymentFx/);
  assert.doesNotMatch(route, /usd_equivalent = \$\{usdEquivalent/);
  assert.match(fx, /amount\s*\/\s*exchangeRate/);
});

test("online expense creation uses a stable idempotency key", () => {
  const page = read("src/app/(dashboard)/expenses/page.tsx");
  assert.match(page, /createRequestRef/);
  assert.match(page, /"x-sync-request-id"/);
});

test("customer hard-delete cannot erase accounting history", () => {
  const route = read("src/app/api/v1/customers/[id]/hard-delete/route.ts");
  assert.match(route, /CUSTOMER_HAS_ACCOUNTING_HISTORY/);
  assert.doesNotMatch(route, /journalEntry\.deleteMany/);
  assert.doesNotMatch(route, /sale\.deleteMany/);
  assert.doesNotMatch(route, /payment\.deleteMany/);
});

test("supplier and shipping edits reread journal versions after locking", () => {
  for (const path of [
    "src/app/api/v1/supplier-payments/[id]/route.ts",
    "src/app/api/v1/shipping-line-payments/[id]/route.ts",
  ]) {
    const route = read(path);
    const lockIndex = route.indexOf("pg_advisory_xact_lock");
    const rereadIndex = route.indexOf("findUnique", lockIndex);
    const reverseIndex = route.indexOf("reverseJournalEntries", rereadIndex);
    assert.ok(lockIndex >= 0 && rereadIndex > lockIndex && reverseIndex > rereadIndex, path);
  }
});

test("opening balance replacements serialize by natural accounting key", () => {
  const route = read("src/app/api/v1/openings/route.ts");
  assert.match(route, /function lockOpeningScope/);
  assert.ok((route.match(/lockOpeningScope\(tx/g) || []).length >= 9);
});

test("maintenance scripts are preview-only and require exact target acknowledgement", () => {
  const guard = read("scripts/database-target-safety.ts");
  const backfill = read("scripts/backfill-superadmin-transfer-links.ts");
  const purge = read("scripts/purge-legacy-stock.ts");
  assert.match(guard, /--apply/);
  assert.match(guard, /--ack=/);
  assert.match(guard, /--allow-remote/);
  assert.match(backfill, /PREVIEW_ONLY/);
  assert.match(backfill, /pg_advisory_xact_lock/);
  assert.match(purge, /PREVIEW_ONLY/);
  assert.match(purge, /\$transaction/);
});

test("backup and restore scripts verify artifacts and acknowledged targets", () => {
  const backup = read("scripts/backup-db.sh");
  const restore = read("scripts/restore-db.sh");
  assert.match(backup, /MIN_BACKUP_BYTES/);
  assert.match(backup, /EXPLICIT_BACKUP_DIR/);
  assert.match(backup, /sha256/);
  assert.match(backup, /manifest\.json/);
  assert.match(restore, /RESTORE_ACKNOWLEDGEMENT/);
  assert.match(restore, /--single-transaction/);
  assert.match(restore, /ALLOW_REMOTE_DATABASE_RESTORE/);
});
