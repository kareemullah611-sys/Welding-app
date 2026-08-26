import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supplierCreate = readFileSync("src/app/api/v1/supplier-payments/route.ts", "utf8");
const supplierEdit = readFileSync("src/app/api/v1/supplier-payments/[id]/route.ts", "utf8");
const shippingCreate = readFileSync("src/app/api/v1/shipping-line-payments/route.ts", "utf8");
const shippingEdit = readFileSync("src/app/api/v1/shipping-line-payments/[id]/route.ts", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");
const attribution = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
const periodReport = readFileSync("src/lib/period-profit-report-data.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260823120000_realized_liability_fx/migration.sql", "utf8");

test("supplier settlement persists documented carrying basis and realized FX atomically", () => {
  assert.match(supplierCreate, /supplier-liability:/);
  assert.match(supplierCreate, /resolveSupplierSettlementContext/);
  assert.match(supplierCreate, /carryingRatePkr: fx\.carryingRatePkr/);
  assert.match(supplierCreate, /realizedFxPkr: fx\.realizedFxPkr/);
  assert.match(supplierCreate, /FX_BASIS_REQUIRED/);
});

test("shipping settlement persists documented carrying basis and realized FX atomically", () => {
  assert.match(shippingCreate, /shipping-liability:/);
  assert.match(shippingCreate, /resolveShippingSettlementContext/);
  assert.match(shippingCreate, /carryingAmountPkr: fx\.carryingAmountPkr/);
  assert.match(shippingCreate, /realizedFxPkr: fx\.realizedFxPkr/);
  assert.match(shippingCreate, /FX_BASIS_REQUIRED/);
});

test("settlement edits and deletes reverse the current journal revision", () => {
  assert.match(supplierEdit, /settlementJournalTransactionId\("SUPPPAY", id, existing\.journalVersion\)/);
  assert.match(supplierEdit, /journalVersion: \{ increment: 1 \}/);
  assert.match(shippingEdit, /settlementJournalTransactionId\("SLPAY", id, existing\.journalVersion\)/);
  assert.match(shippingEdit, /journalVersion: \{ increment: 1 \}/);
});

test("realized FX journals use separate P&L accounts and remain PKR-only", () => {
  assert.match(accounting, /"FX-GAIN", "Foreign Exchange Gain"/);
  assert.match(accounting, /"FX-LOSS", "Foreign Exchange Loss"/);
  assert.match(accounting, /Realized supplier FX loss/);
  assert.match(accounting, /Realized shipping FX gain/);
  assert.match(accounting, /currencyCode: "PKR", entityType: "supplier_payment"/);
  assert.match(accounting, /currencyCode: "PKR", entityType: "shipping_line_payment"/);
});

test("realized supplier and shipping FX enter the historical pool from original pool dates", () => {
  assert.match(attribution, /sourceId: `supplier-payment:\$\{payment\.id\}`/);
  assert.match(attribution, /sourceId: `shipping-payment:\$\{payment\.id\}`/);
  assert.match(attribution, /originalPoolDate: dateOnly\(payment\.fxPoolDate!\)/);
  assert.match(attribution, /amountPkr: Number\(payment\.realizedFxPkr\)/);
});

test("later supplier payments do not rewrite original lot inventory or COGS basis", () => {
  assert.doesNotMatch(periodReport, /purchasePkrFromLinkedSupplierPayments/);
  assert.doesNotMatch(periodReport, /purchasePkrOverride/);
});

test("realized FX migration is additive and contains no destructive operations", () => {
  assert.match(migration, /ALTER TABLE "supplier_payments"/);
  assert.match(migration, /ALTER TABLE "shipping_line_payments"/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
});
