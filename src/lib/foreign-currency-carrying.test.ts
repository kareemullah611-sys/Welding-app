import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allocateForeignCurrencyLayers,
  buildForeignCurrencyExchange,
  buildForeignCurrencySettlement,
  buildForeignCurrencyTransfer,
  canonicalForeignCurrencyCode,
  isSupportedForeignCurrency,
} from "./foreign-currency-carrying";

test("canonical foreign currencies include USD AFN CNY and AED while RMB aliases to CNY", () => {
  assert.equal(canonicalForeignCurrencyCode("rmb"), "CNY");
  assert.equal(canonicalForeignCurrencyCode("cny"), "CNY");
  for (const code of ["USD", "AFN", "CNY", "RMB", "AED"]) {
    assert.equal(isSupportedForeignCurrency(code), true);
  }
  assert.equal(isSupportedForeignCurrency("PKR"), false);
});

test("FIFO allocation preserves each source carrying basis and historical pool", () => {
  const allocations = allocateForeignCurrencyLayers({
    amount: 150,
    layers: [
      { id: 1, remainingForeignAmount: 100, remainingCarryingAmountPkr: 28_000, historicalPoolDate: "2025-03-01" },
      { id: 2, remainingForeignAmount: 100, remainingCarryingAmountPkr: 30_000, historicalPoolDate: "2026-03-01" },
    ],
  });

  assert.deepEqual(allocations, [
    { layerId: 1, foreignAmount: 100, carryingAmountPkr: 28_000, historicalPoolDate: "2025-03-01" },
    { layerId: 2, foreignAmount: 50, carryingAmountPkr: 15_000, historicalPoolDate: "2026-03-01" },
  ]);
});

test("same-currency transfer moves carrying value without an FX gain or loss", () => {
  const transfer = buildForeignCurrencyTransfer({
    currencyCode: "AFN",
    foreignAmount: 70_000,
    carryingAmountPkr: 280_000,
    historicalPoolDate: "2025-03-01",
  });

  assert.equal(transfer.targetCurrencyCode, "AFN");
  assert.equal(transfer.targetCarryingAmountPkr, 280_000);
  assert.equal(transfer.realizedFxPkr, 0);
  assert.equal(transfer.historicalPoolDate, "2025-03-01");
});

test("asset settlement recognizes gain and loss against historical carrying value", () => {
  const gain = buildForeignCurrencySettlement({
    positionKind: "asset",
    foreignAmount: 10_000,
    carryingAmountPkr: 40_000,
    settlementAmountPkr: 42_000,
    historicalPoolDate: "2025-03-01",
  });
  const loss = buildForeignCurrencySettlement({
    positionKind: "asset",
    foreignAmount: 10_000,
    carryingAmountPkr: 40_000,
    settlementAmountPkr: 38_000,
    historicalPoolDate: "2025-03-01",
  });

  assert.equal(gain.realizedFxPkr, 2_000);
  assert.equal(loss.realizedFxPkr, -2_000);
  assert.equal(gain.historicalPoolDate, "2025-03-01");
  assert.equal(loss.historicalPoolDate, "2025-03-01");
});

test("liability settlement uses the opposite gain and loss direction", () => {
  const loss = buildForeignCurrencySettlement({
    positionKind: "liability",
    foreignAmount: 10_000,
    carryingAmountPkr: 40_000,
    settlementAmountPkr: 42_000,
    historicalPoolDate: "2025-03-01",
  });
  const gain = buildForeignCurrencySettlement({
    positionKind: "liability",
    foreignAmount: 10_000,
    carryingAmountPkr: 40_000,
    settlementAmountPkr: 38_000,
    historicalPoolDate: "2025-03-01",
  });

  assert.equal(loss.realizedFxPkr, -2_000);
  assert.equal(gain.realizedFxPkr, 2_000);
});

test("foreign exchange preserves basis cross-currency and realizes FX only when converted to PKR", () => {
  const crossCurrency = buildForeignCurrencyExchange({
    sourceForeignAmount: 70_000,
    sourceCarryingAmountPkr: 280_000,
    targetCurrencyCode: "USD",
    targetAmount: 1_000,
    historicalPoolDate: "2025-03-01",
  });
  assert.equal(crossCurrency.targetCarryingAmountPkr, 280_000);
  assert.equal(crossCurrency.targetRecognitionRatePkr, 280);
  assert.equal(crossCurrency.realizedFxPkr, 0);

  const pkrConversion = buildForeignCurrencyExchange({
    sourceForeignAmount: 1_000,
    sourceCarryingAmountPkr: 280_000,
    targetCurrencyCode: "PKR",
    targetAmount: 285_000,
    historicalPoolDate: "2025-03-01",
  });
  assert.equal(pkrConversion.targetCarryingAmountPkr, 285_000);
  assert.equal(pkrConversion.realizedFxPkr, 5_000);
  assert.equal(pkrConversion.historicalPoolDate, "2025-03-01");
});

test("carrying-layer migration is additive and the sale path recognizes AED", () => {
  const migration = readFileSync("prisma/migrations/20260918120000_foreign_currency_carrying_layers/migration.sql", "utf8");
  const saleRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const attributionRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");

  assert.match(migration, /CREATE TABLE "foreign_currency_carrying_layers"/);
  assert.match(migration, /CREATE TABLE "foreign_currency_movements"/);
  assert.doesNotMatch(migration, /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/im);
  assert.match(saleRoute, /\["AFN", "USD", "CNY", "AED"\]/);
  assert.match(attributionRoute, /"AED"/);
});

test("intermediary exchange create edit and delete use the generalized carrying layer", () => {
  const createRoute = readFileSync("src/app/api/v1/intermediaries/[id]/exchanges/route.ts", "utf8");
  const itemRoute = readFileSync("src/app/api/v1/intermediary-exchanges/[id]/route.ts", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");

  assert.match(createRoute, /exchangeForeignCurrencyLayers\(/);
  assert.match(createRoute, /journalForeignIntermediaryExchangeMovements\(/);
  assert.match(itemRoute, /reverseForeignCurrencyMovements\(/);
  assert.match(itemRoute, /exchangeForeignCurrencyLayers\(/);
  assert.match(itemRoute, /journalForeignIntermediaryExchangeMovements\(/);
  assert.match(accounting, /Realized intermediary FX gain/);
  assert.match(accounting, /Realized intermediary FX loss/);
});

test("fresh foreign openings seed carrying layers without historical backfill", () => {
  const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");

  assert.match(openingsRoute, /recordOpeningForeignPosition/);
  assert.match(openingsRoute, /sourceType: "opening_cash"/);
  assert.match(openingsRoute, /sourceType: "opening_customer_balance"/);
  assert.match(openingsRoute, /sourceType: "opening_bank_balance"/);
  assert.match(openingsRoute, /sourceType: "opening_liability"/);
  assert.match(openingsRoute, /sourceType: "opening_super_admin_account"/);
  assert.match(openingsRoute, /reverseForeignCurrencyRecognition\(/);
  assert.doesNotMatch(openingsRoute, /backfillForeignCurrency|historicalForeignBackfill/);
});

test("Afghanistan foreign expenses consume carrying cash and post PKR expense plus explicit FX", () => {
  const createRoute = readFileSync("src/app/api/v1/expenses/route.ts", "utf8");
  const itemRoute = readFileSync("src/app/api/v1/expenses/[id]/route.ts", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");

  assert.match(createRoute, /settleForeignCurrencyOutflow\(/);
  assert.match(createRoute, /journalForeignExpenseMovements\(/);
  assert.match(createRoute, /sourceType: "expense_customer_payment"/);
  assert.match(itemRoute, /reverseForeignCurrencyMovements\(/);
  assert.match(accounting, /FXEXP/);
  assert.match(accounting, /realized FX gain/);
  assert.match(accounting, /realized FX loss/);
});

test("foreign withdrawals consume carrying cash at creation while approval stays audit-only", () => {
  const createRoute = readFileSync("src/app/api/v1/personal-withdrawals/route.ts", "utf8");
  const approvalRoute = readFileSync("src/app/api/v1/personal-withdrawals/[id]/approve/route.ts", "utf8");
  const hajiAccounting = readFileSync("src/lib/haji-transfer-accounting.ts", "utf8");

  assert.match(createRoute, /recordHajiTransferAccounting\(/);
  assert.match(hajiAccounting, /transferForeignCurrencyLayers\(/);
  assert.match(hajiAccounting, /foreignCurrencyOwnerKey\.cityCash/);
  assert.match(hajiAccounting, /foreignCurrencyOwnerKey\.cityBank/);
  assert.doesNotMatch(approvalRoute, /transferForeignCurrencyLayers\(/);
  assert.doesNotMatch(approvalRoute, /settleForeignCurrencyOutflow\(/);
  assert.doesNotMatch(approvalRoute, /journalWithdrawal\(/);
});

test("fresh USD lot purchases and freight costs create auditable liability carrying layers", () => {
  const purchaseCreate = readFileSync("src/app/api/v1/lot-purchases/route.ts", "utf8");
  const purchaseItem = readFileSync("src/app/api/v1/lot-purchases/[id]/route.ts", "utf8");
  const costCreate = readFileSync("src/app/api/v1/lot-costs/route.ts", "utf8");
  const costItem = readFileSync("src/app/api/v1/lot-costs/[id]/route.ts", "utf8");

  assert.match(purchaseCreate, /recordForeignCurrencyRecognition\(/);
  assert.match(purchaseCreate, /sourceType: "lot_purchase"/);
  assert.match(purchaseCreate, /foreignCurrencyOwnerKey\.supplierPayable/);
  assert.match(purchaseItem, /reverseForeignCurrencyRecognition\(/);
  assert.match(costCreate, /sourceType: "lot_shipping_cost"/);
  assert.match(costCreate, /foreignCurrencyOwnerKey\.shippingPayable/);
  assert.match(costItem, /reverseForeignCurrencyRecognition\(/);
});

test("supplier and shipping settlements close liability layers without creating duplicate FX journals", () => {
  const supplierCreate = readFileSync("src/app/api/v1/supplier-payments/route.ts", "utf8");
  const supplierItem = readFileSync("src/app/api/v1/supplier-payments/[id]/route.ts", "utf8");
  const shippingCreate = readFileSync("src/app/api/v1/shipping-line-payments/route.ts", "utf8");
  const shippingItem = readFileSync("src/app/api/v1/shipping-line-payments/[id]/route.ts", "utf8");

  for (const source of [supplierCreate, shippingCreate]) {
    assert.match(source, /settleForeignCurrencyLiability\(/);
    assert.match(source, /journalTransactionId:/);
    assert.match(source, /assertForeignLiabilitySettlementReconciles\(/);
  }
  assert.match(supplierItem, /reverseForeignCurrencyMovements\(/);
  assert.match(shippingItem, /reverseForeignCurrencyMovements\(/);
  assert.doesNotMatch(supplierCreate, /journalForeign.*Liability/);
  assert.doesNotMatch(shippingCreate, /journalForeign.*Liability/);
  assert.match(supplierCreate, /settleForeignCurrencyOutflow\(/);
  assert.match(shippingCreate, /settleForeignCurrencyOutflow\(/);
  assert.match(supplierCreate, /journalForeignFundingAssetAdjustments\(/);
  assert.match(shippingCreate, /journalForeignFundingAssetAdjustments\(/);
});

test("superadmin and intermediary internal money movements preserve immutable foreign carrying layers", () => {
  const accountTransfer = readFileSync("src/app/api/v1/super-admin-account-transfers/route.ts", "utf8");
  const accountTransferReversal = readFileSync("src/app/api/v1/super-admin-account-transfers/[id]/reverse/route.ts", "utf8");
  const intermediaryDeposit = readFileSync("src/app/api/v1/intermediaries/[id]/deposits/route.ts", "utf8");
  const intermediaryDepositItem = readFileSync("src/app/api/v1/intermediary-deposits/[id]/route.ts", "utf8");
  const intermediaryReceipt = readFileSync("src/app/api/v1/haji-cash-receipts/route.ts", "utf8");
  const intermediaryReceiptReversal = readFileSync("src/app/api/v1/haji-cash-receipts/[id]/reverse/route.ts", "utf8");

  assert.match(accountTransfer, /exchangeForeignCurrencyLayers\(/);
  assert.match(accountTransfer, /transferForeignCurrencyLayers\(/);
  assert.match(accountTransferReversal, /reverseForeignCurrencyMovements\(/);
  assert.match(intermediaryDeposit, /transferForeignCurrencyLayers\(/);
  assert.match(intermediaryDepositItem, /reverseForeignCurrencyMovements\(/);
  assert.match(intermediaryReceipt, /transferForeignCurrencyLayers\(/);
  assert.match(intermediaryReceiptReversal, /reverseForeignCurrencyMovements\(/);
});

test("city cheque cash and bank transfers move foreign carrying layers for create edit and delete", () => {
  const createRoute = readFileSync("src/app/api/v1/bank-deposits/route.ts", "utf8");
  const itemRoute = readFileSync("src/app/api/v1/bank-deposits/[id]/route.ts", "utf8");
  const paymentCreate = readFileSync("src/app/api/v1/payments/route.ts", "utf8");

  assert.match(paymentCreate, /foreignCurrencyOwnerKey\.cityCheque/);
  assert.match(createRoute, /applyForeignCityTreasuryTransfer\(/);
  assert.match(itemRoute, /reverseForeignCurrencyMovements\(/);
  assert.match(itemRoute, /applyForeignCityTreasuryTransfer\(/);
});
