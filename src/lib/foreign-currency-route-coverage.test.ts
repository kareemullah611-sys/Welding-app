import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

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
    assert.match(read(path), /foreign-currency-carrying|foreign-city-treasury|haji-transfer-accounting/, path);
  }
});
