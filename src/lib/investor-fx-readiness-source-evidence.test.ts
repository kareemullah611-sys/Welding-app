import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("investor FX readiness accepts immutable source rate evidence before requiring fallback rates", () => {
  const route = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");

  assert.match(route, /fxSelectedRate: true/);
  assert.match(route, /fxProviderReference: true/);
  assert.match(route, /carriedPaymentIds/);
  assert.match(route, /sourceType: "customer_payment"/);
});
