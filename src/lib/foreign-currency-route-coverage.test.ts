import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function collectRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectRouteFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const WIRED = /(?:recordForeignCurrencyRecognition|reverseForeignCurrencyRecognition|settleForeignCurrencyAsset|settleForeignCurrencyLiability|settleForeignCurrencyOutflow|transferForeignCurrencyLayers|exchangeForeignCurrencyLayers|applyForeignCityTreasuryTransfer|recordHajiTransferAccounting|createForeignCurrencyMovement)\s*\(/;
const BLOCKED = /FOREIGN_CARRYING_LAYER_REQUIRED/;
const ACCEPTS_CURRENCY = /currencyId|currencyCode/;
const EXPORTS_A_WRITE = /^export (async function|const) (POST|PUT|PATCH|DELETE)/m;

/**
 * Currency-accepting write routes that deliberately persist no monetary amount,
 * with the reason. Anything absent from this map must either wire a carrying
 * layer or reject non-PKR writes outright.
 */
const NON_MONETARY_CURRENCY_WRITES: Record<string, string> = {
  "src/app/api/v1/agents/route.ts": "agent master data; no amount persisted",
  "src/app/api/v1/agents/[id]/route.ts": "agent master data; no amount persisted",
  "src/app/api/v1/shipping-lines/route.ts": "shipping-line master data; no amount persisted",
  "src/app/api/v1/shipping-lines/[id]/route.ts": "shipping-line master data; no amount persisted",
  "src/app/api/v1/liabilities/route.ts": "liability account setup; entries carry the amount",
  "src/app/api/v1/super-admin-liabilities/route.ts": "liability account setup; entries carry the amount",
  "src/app/api/v1/super-admin-liability-entries/[id]/reverse/route.ts": "reversal only; mirrors an existing PKR entry",
  "src/app/api/v1/lots/[id]/complete/route.ts": "lot status transition; no monetary write",
  "src/app/api/v1/lots/[id]/reopen/route.ts": "reversal + lot status; no new monetary write",
  "src/app/api/v1/customers/route.ts": "customer master data; no currency amount persisted",
  "src/app/api/v1/financial-years/[id]/route.ts": "period control; no monetary write",
  "src/app/api/v1/investors/route.ts": "investor master data; no journal written",
  "src/app/api/v1/investment-participants/route.ts": "participant master data; no journal written",
  "src/app/api/v1/investment-participants/[id]/actions/[actionId]/settlements/route.ts":
    "settlement creation; foreign settlement is feature-flagged and separately blocked",
  "src/app/api/v1/investor-attribution/route.ts": "attribution ledger; PKR recognition only",
  // Bank account records hold balances but write no journal; money reaches the
  // ledger through bank-deposits / payments, which are wired.
  "src/app/api/v1/bank-accounts/route.ts": "bank account master data; no journal written",
  "src/app/api/v1/bank-accounts/[id]/route.ts": "bank account master data; no journal written",
};

test("every currency-accepting write route is wired, blocked, or explicitly non-monetary", () => {
  const uncovered: string[] = [];

  for (const file of collectRouteFiles("src/app/api/v1").sort()) {
    const source = read(file);
    if (!ACCEPTS_CURRENCY.test(source)) continue;
    if (!EXPORTS_A_WRITE.test(source)) continue;
    if (WIRED.test(source) || BLOCKED.test(source)) continue;
    if (NON_MONETARY_CURRENCY_WRITES[file]) continue;
    uncovered.push(file);
  }

  assert.deepEqual(
    uncovered,
    [],
    `These currency-accepting write routes neither wire a carrying layer, reject non-PKR writes, nor declare a non-monetary reason:\n${uncovered.join("\n")}`
  );
});

test("an import or permissive gate alone is not proof of carrying-layer wiring", () => {
  const importOnly = `
    import { checkCarryingLayerWired } from "@/lib/foreign-currency-carrying";
    export const POST = async () => ({ currencyCode: "USD" });
  `;
  assert.doesNotMatch(importOnly, WIRED);
  assert.doesNotMatch(importOnly, BLOCKED);
});

test("non-monetary classification stays accurate and free of stale entries", () => {
  for (const [file, reason] of Object.entries(NON_MONETARY_CURRENCY_WRITES)) {
    assert.ok(reason.length > 10, `${file} must record why it persists no monetary amount`);
    assert.doesNotMatch(read(file), /createJournalEntries|createForeignCurrencyMovement/, `${file} is classified non-monetary but writes a journal`);
    assert.doesNotMatch(read(file), /recordForeignCurrencyRecognition|transferForeignCurrencyLayers|exchangeForeignCurrencyLayers/, `${file} is classified non-monetary but records a carrying layer`);
  }
  for (const file of Object.keys(NON_MONETARY_CURRENCY_WRITES)) {
    const source = read(file);
    assert.ok(ACCEPTS_CURRENCY.test(source), `${file} is classified but no longer accepts a currency`);
    assert.ok(EXPORTS_A_WRITE.test(source), `${file} is classified but no longer exports a write`);
  }
});

test("bank deposits are wired to the carrying layer rather than journalizing raw foreign units", () => {
  for (const path of ["src/app/api/v1/bank-deposits/route.ts", "src/app/api/v1/bank-deposits/[id]/route.ts"]) {
    assert.match(read(path), WIRED, `${path} must wire a carrying layer`);
  }
});

test("legacy foreign transaction paths cannot bypass immutable carrying layers", () => {
  const blockedUntilWired = [
    "src/app/api/v1/agent-payments/route.ts",
    "src/app/api/v1/agent-payments/[id]/route.ts",
    "src/app/api/v1/liabilities/[id]/entries/route.ts",
    "src/app/api/v1/super-admin-personal-expenses/route.ts",
    "src/app/api/v1/super-admin-personal-expenses/[id]/route.ts",
    "src/app/api/v1/sales/[id]/discount/route.ts",
    "src/app/api/v1/sales/[id]/hard-delete/route.ts",
    "src/app/api/v1/payments/[id]/hard-delete/route.ts",
    "src/app/api/v1/super-admin-liabilities/[id]/entries/route.ts",
    "src/app/api/v1/investment-participants/[id]/actions/[actionId]/settlements/[settlementId]/payments/route.ts",
  ];
  for (const path of blockedUntilWired) {
    assert.match(read(path), /FOREIGN_CARRYING_LAYER_REQUIRED/, path);
  }
});

test("foreign lot costs are limited to the shipping-liability path that has carrying layers", () => {
  const createRoute = read("src/app/api/v1/lot-costs/route.ts");
  const editRoute = read("src/app/api/v1/lot-costs/[id]/route.ts");
  assert.match(createRoute, /FOREIGN_CARRYING_LAYER_REQUIRED/);
  assert.match(createRoute, /shippingLineId/);
  assert.match(editRoute, /FOREIGN_CARRYING_LAYER_REQUIRED/);
});

test("supported superadmin and city foreign transaction paths use carrying-layer services", () => {
  const supported = [
    "src/app/api/v1/sales/route.ts",
    "src/app/api/v1/payments/route.ts",
    "src/app/api/v1/expenses/route.ts",
    "src/app/api/v1/haji-transfers/route.ts",
    "src/app/api/v1/openings/route.ts",
    "src/app/api/v1/supplier-payments/route.ts",
    "src/app/api/v1/shipping-line-payments/route.ts",
    "src/app/api/v1/super-admin-account-transfers/route.ts",
    "src/app/api/v1/intermediaries/[id]/deposits/route.ts",
    "src/app/api/v1/intermediaries/[id]/exchanges/route.ts",
  ];
  for (const path of supported) {
    assert.match(read(path), WIRED, path);
  }
});
