import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHistoricalOpeningAdjustmentPlan,
  historicalOpeningAdjustmentTransactionId,
} from "./historical-opening-accounting";

test("opening imports reduce inventory through equity without revenue or COGS", () => {
  const plan = buildHistoricalOpeningAdjustmentPlan({
    saleId: 115,
    isOpeningImport: true,
    proposedCostPkr: 42500,
    hasSaleJournal: true,
    hasCogsJournal: false,
    hasOpeningAdjustment: false,
  });

  assert.equal(plan.postOperatingCogs, false);
  assert.equal(plan.postOpeningAdjustment, true);
  assert.equal(plan.openingAdjustmentPkr, 42500);
  assert.deepEqual(plan.reverseTransactionIds, ["SALE-115"]);
  assert.equal(plan.openingAdjustmentTransactionId, "OPENING-STOCK-COST-115");
});

test("normal sales remain on the operating COGS path", () => {
  const plan = buildHistoricalOpeningAdjustmentPlan({
    saleId: 200,
    isOpeningImport: false,
    proposedCostPkr: 1200,
    hasSaleJournal: true,
    hasCogsJournal: false,
    hasOpeningAdjustment: false,
  });

  assert.equal(plan.postOperatingCogs, true);
  assert.equal(plan.postOpeningAdjustment, false);
  assert.deepEqual(plan.reverseTransactionIds, []);
});

test("existing opening adjustment is idempotent", () => {
  const plan = buildHistoricalOpeningAdjustmentPlan({
    saleId: 3,
    isOpeningImport: true,
    proposedCostPkr: 1725110,
    hasSaleJournal: false,
    hasCogsJournal: false,
    hasOpeningAdjustment: true,
  });

  assert.equal(plan.postOpeningAdjustment, false);
  assert.equal(historicalOpeningAdjustmentTransactionId(3), "OPENING-STOCK-COST-3");
});

test("already reversed accidental opening journals are not proposed again", () => {
  const plan = buildHistoricalOpeningAdjustmentPlan({
    saleId: 115,
    isOpeningImport: true,
    proposedCostPkr: 42500,
    hasSaleJournal: true,
    hasSaleReversal: true,
    hasCogsJournal: false,
    hasCogsReversal: false,
    hasOpeningAdjustment: true,
  });

  assert.deepEqual(plan.reverseTransactionIds, []);
  assert.equal(plan.postOpeningAdjustment, false);
});

test("sale correction and opening deletion preserve opening-import accounting isolation", () => {
  const correctionRoute = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");
  const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");

  assert.match(correctionRoute, /sale\.isOpeningImport/);
  assert.match(correctionRoute, /Historical opening sale accounting has been adjusted/);
  assert.match(openingsRoute, /OPENING-STOCK-COST-/);
  assert.match(accounting, /Historical Stock Adjustment/);
  assert.match(accounting, /isOpeningImport/);
});

test("historical correction runner is clone-gated and preview-first", () => {
  const runner = readFileSync("scripts/historical-accounting-correction.ts", "utf8");

  assert.match(runner, /welding_app_production_clone_/);
  assert.match(runner, /READ_ONLY_PREVIEW/);
  assert.match(runner, /--apply/);
  assert.match(runner, /HISTORICAL_CORRECTION_ACK/);
  assert.match(runner, /OPENING-STOCK-COST-/);
  assert.match(runner, /startsWith: "REV-SALE-"/);
  assert.match(runner, /startsWith: "REV-COGS-"/);
});

test("production historical correction requires exact target acknowledgement and verified backup", () => {
  const runner = readFileSync("scripts/historical-accounting-correction.ts", "utf8");

  assert.match(runner, /--production/);
  assert.match(runner, /APPLY_APPROVED_HISTORICAL_CORRECTION_TO_PRODUCTION/);
  assert.match(runner, /HISTORICAL_CORRECTION_EXPECTED_HOST/);
  assert.match(runner, /HISTORICAL_CORRECTION_EXPECTED_DATABASE/);
  assert.match(runner, /HISTORICAL_CORRECTION_BACKUP_FILE/);
  assert.match(runner, /pg_restore/);
  assert.match(runner, /productionMode\s*\?\s*600_000\s*:\s*120_000/);
});

test("historical COGS preview separates opening equity adjustments from operating COGS", () => {
  const preview = readFileSync("scripts/historical-cogs-preview.ts", "utf8");

  assert.match(preview, /OPENING-STOCK-COST-/);
  assert.match(preview, /existingOpeningAdjustmentRows/);
  assert.match(preview, /proposedOpeningAdjustmentRows/);
  assert.match(preview, /OPENING_EQUITY_ADJUSTMENT/);
});

test("sale COGS excludes city expenses that already have separate expense journals", () => {
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const preview = readFileSync("scripts/historical-cogs-preview.ts", "utf8");
  const cogsCalculator = accounting.slice(
    accounting.indexOf("export async function calculateSaleCogsPkr"),
    accounting.indexOf("export async function journalSaleCOGS"),
  );

  assert.doesNotMatch(cogsCalculator, /db\.expense\.findMany/);
  assert.match(cogsCalculator, /lotExpensesByCurrency:\s*\{\}/);
  assert.doesNotMatch(preview, /groupExpensesByCurrency/);
  assert.match(preview, /lotExpensesByCurrency:\s*\{\}/);
});
