import assert from "node:assert/strict";
import test from "node:test";

import { normalizePaymentFx } from "@/lib/payment-fx";

test("AFN payment USD equivalent is derived from amount and AFN-per-USD rate", () => {
  assert.deepEqual(normalizePaymentFx({ amount: 3500, currencyCode: "AFN", exchangeRate: 70 }), {
    exchangeRate: 70,
    usdEquivalent: 50,
  });
});

test("USD payment keeps its original amount as USD equivalent", () => {
  assert.deepEqual(normalizePaymentFx({ amount: 125.5, currencyCode: "USD", exchangeRate: 999 }), {
    exchangeRate: null,
    usdEquivalent: 125.5,
  });
});

test("PKR payment does not persist unrelated foreign exchange metadata", () => {
  assert.deepEqual(normalizePaymentFx({ amount: 1000, currencyCode: "PKR", exchangeRate: 280 }), {
    exchangeRate: null,
    usdEquivalent: null,
  });
});
