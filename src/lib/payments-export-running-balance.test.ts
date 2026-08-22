import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("city payments PDF shares module balances and stays newest first under filters", () => {
  const exportRoute = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(exportRoute, /computeRunningBalances/);
  assert.match(exportRoute, /openingCashByCurrency/);
  assert.match(exportRoute, /getCombinedItemNetDelta/);
  assert.match(exportRoute, /filteredEntries\.sort\(comparePaymentExportNewestFirst\)/);
  assert.match(paymentsPage, /const paymentExportType: LedgerExportType = "payments"/);

  const paymentsExportStart = exportRoute.indexOf('type === "payments"');
  assert.ok(
    exportRoute.indexOf("matchesExportTextSearch(", paymentsExportStart) < exportRoute.indexOf("computeRunningBalances", paymentsExportStart),
    "active filters must be applied before the PDF running balance is calculated",
  );
});
