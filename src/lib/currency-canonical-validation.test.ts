import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANONICAL_CURRENCY_CODES,
  UnsupportedCurrencyCodeError,
  assertCanonicalCurrencyCode,
} from "@/lib/foreign-currency-carrying";
import { normalizeCurrencyCode } from "@/lib/lot-cost-currency";

test("the canonical currency set is closed and matches the policy", () => {
  assert.deepEqual([...CANONICAL_CURRENCY_CODES], ["PKR", "USD", "AFN", "CNY", "AED"]);
  // RMB is an alias, never a persisted currency.
  assert.ok(!(CANONICAL_CURRENCY_CODES as readonly string[]).includes("RMB"));
});

test("RMB is normalized to CNY rather than persisted separately", () => {
  for (const alias of ["RMB", "rmb", " RmB "]) {
    assert.equal(assertCanonicalCurrencyCode(alias), "CNY");
  }
});

test("codes are trimmed and upper-cased before validation", () => {
  assert.equal(assertCanonicalCurrencyCode(" usd "), "USD");
  assert.equal(assertCanonicalCurrencyCode("pkr"), "PKR");
});

test("unknown codes are rejected instead of coerced", () => {
  for (const bad of ["EUR", "US", "USDD", "", "  ", null, undefined, 42, "PKR "]) {
    const expected = bad === "PKR " ? "PKR" : null;
    if (expected) {
      assert.equal(assertCanonicalCurrencyCode(bad), expected);
      continue;
    }
    assert.throws(() => assertCanonicalCurrencyCode(bad), UnsupportedCurrencyCodeError, `expected ${String(bad)} to be rejected`);
  }
});

test("lot cost currency normalization accepts the RMB alias as CNY", () => {
  assert.equal(normalizeCurrencyCode("RMB"), "CNY");
  assert.equal(normalizeCurrencyCode("rmb"), "CNY");
  assert.equal(normalizeCurrencyCode("CNY"), "CNY");
  assert.equal(normalizeCurrencyCode("USD"), "USD");
  assert.equal(normalizeCurrencyCode("EUR"), null);
  assert.equal(normalizeCurrencyCode(""), null);
});

test("agent payments persist the validated code, never the raw client string", () => {
  const source = readFileSync("src/app/api/v1/agent-payments/route.ts", "utf8");
  assert.match(source, /assertCanonicalCurrencyCode/);
  assert.doesNotMatch(source, /currencyCode: body\.currencyCode/);
  // The audit row and the business row must both use the canonical value.
  assert.match(source, /amount, currencyCode,/);
  assert.match(source, /^\s*currencyCode,$/m);
});

test("currency codes are not accepted from the client anywhere else unguarded", () => {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        const text = readFileSync(full, "utf8");
        if (/currencyCode:\s*body\.currencyCode/.test(text)) offenders.push(full);
      }
    }
  };
  walk("src/app/api/v1");
  assert.deepEqual(offenders, [], `raw client currency codes must not be persisted: ${offenders.join(", ")}`);
});
