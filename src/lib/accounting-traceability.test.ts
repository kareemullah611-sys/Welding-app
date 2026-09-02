import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildLotStockTrace } from "./accounting-traceability";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("consolidated financial APIs are superadmin-only", () => {
  const financialReports = read("src/app/api/v1/financial-reports/route.ts");
  const profitReport = read("src/app/api/v1/profit-report/route.ts");

  assert.match(financialReports, /import \{ withSuperAdmin \} from "@\/lib\/middleware"/);
  assert.match(financialReports, /export const GET = withSuperAdmin\(/);
  assert.match(profitReport, /import \{ withSuperAdmin \} from "@\/lib\/middleware"/);
  assert.match(profitReport, /export const GET = withSuperAdmin\(/);
});

test("city operational inventory remains city-scoped without consolidated trace data", () => {
  const inventoryRoute = read("src/app/api/v1/inventory/route.ts");

  assert.match(inventoryRoute, /getCityScope\(user,/);
  assert.doesNotMatch(inventoryRoute, /accountingTrace|profitAndLoss|investorAttribution/);
});

test("lot accounting trace remains behind the existing city-admin early return", () => {
  const lotRoute = read("src/app/api/v1/lots/[id]/route.ts");
  const cityReturn = lotRoute.indexOf("return successResponse(result.data)");
  const accountingTrace = lotRoute.indexOf("const accountingTrace =");

  assert.ok(cityReturn >= 0);
  assert.ok(accountingTrace > cityReturn);
});

test("stock trace reconciles source quantity, sales, remaining stock, and carrying value", () => {
  const rows = buildLotStockTrace({
    lotProducts: [
      { productId: 10, productName: "7018-12", unitOfMeasure: "MT", piecesPerCarton: null, originalQty: 100 },
    ],
    purchases: [
      { id: 5, productId: 10, supplierName: "Supplier A", originalAmountUsd: 20_000, carryingAmountPkr: 5_600_000 },
    ],
    distributed: [{ productId: 10, qty: 80 }],
    sales: [{ productId: 10, qty: 25 }],
    godownTransfers: [{ productId: 10, qty: 12 }],
    cityTransfers: [{ productId: 10, qty: 8, status: "approved" }],
    additionalLandedCostPkr: 400_000,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].originalQuantity, 100);
  assert.equal(rows[0].distributedQuantity, 80);
  assert.equal(rows[0].soldQuantity, 25);
  assert.equal(rows[0].remainingQuantity, 75);
  assert.equal(rows[0].internalTransferQuantity, 20);
  assert.equal(rows[0].landedCostPkr, 6_000_000);
  assert.equal(rows[0].unitCarryingCostPkr, 60_000);
  assert.equal(rows[0].remainingStockValuePkr, 4_500_000);
  assert.equal(rows[0].quantityDifference, 0);
});

test("stock trace exposes missing carrying basis instead of guessing", () => {
  const [row] = buildLotStockTrace({
    lotProducts: [
      { productId: 11, productName: "3.2mm", unitOfMeasure: "MT", piecesPerCarton: null, originalQty: 50 },
    ],
    purchases: [
      { id: 6, productId: 11, supplierName: "Supplier B", originalAmountUsd: 10_000, carryingAmountPkr: null },
    ],
    distributed: [],
    sales: [],
    godownTransfers: [],
    cityTransfers: [],
    additionalLandedCostPkr: 0,
  });

  assert.equal(row.unitCarryingCostPkr, null);
  assert.equal(row.remainingStockValuePkr, null);
  assert.deepEqual(row.blockers, ["Missing authoritative PKR purchase carrying basis"]);
});

test("stock trace reports oversold quantity rather than hiding it", () => {
  const [row] = buildLotStockTrace({
    lotProducts: [{ productId: 12, productName: "6013", unitOfMeasure: "MT", originalQty: 10 }],
    purchases: [{ id: 7, productId: 12, supplierName: "Supplier", originalAmountUsd: 1_000, carryingAmountPkr: 280_000 }],
    distributed: [],
    sales: [{ productId: 12, qty: 12 }],
    godownTransfers: [],
    cityTransfers: [],
    additionalLandedCostPkr: 0,
  });

  assert.equal(row.remainingQuantity, -2);
  assert.ok(row.blockers.includes("Sales exceed original lot quantity"));
});

test("superadmin UI exposes trace without adding it to city assignment detail", () => {
  const lotsPage = read("src/app/(dashboard)/lots/page.tsx");
  const traceComponent = read("src/components/lots/LotDetailTabs.tsx");
  const profitPage = read("src/app/(dashboard)/profit-report/page.tsx");

  assert.match(lotsPage, /key: "trace", label: "Accounting Trace"/);
  assert.match(lotsPage, /activeDetailTab === "trace"/);
  assert.match(traceComponent, /export function LotAccountingTrace/);
  assert.match(profitPage, /Trace accounting/);
  assert.doesNotMatch(traceComponent, /function CityLotAssignmentDetail[\s\S]*accountingTrace/);
});

test("financial report UI presents the authoritative consolidated PKR result", () => {
  const accountsPage = read("src/app/(dashboard)/accounts/page.tsx");

  assert.match(accountsPage, /const p = data\.authoritativePkr/);
  assert.match(accountsPage, /Profit &amp; Loss — PKR/);
  assert.match(accountsPage, /data\.fxWarnings/);
  assert.doesNotMatch(accountsPage, /pnl\.map\(/);
});
