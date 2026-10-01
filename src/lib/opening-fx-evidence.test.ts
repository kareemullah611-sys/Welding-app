import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_HISTORICAL_APPROVAL_PHRASE,
  OPENING_FX_EVIDENCE_PROVIDERS,
  OpeningFxEvidenceError,
  assertOpeningFxEvidence,
} from "@/lib/opening-fx-evidence";

const RATE_DATE = new Date("2026-03-01T00:00:00.000Z");

type FakeDb = {
  sbpDailyFxSnapshot: { findFirst: (a: unknown) => Promise<unknown> };
  sarafiAfFxDerivedRate: { findFirst: (a: unknown) => Promise<unknown> };
  countryFallbackExchangeRate: { findFirst: (a: unknown) => Promise<unknown> };
};

function fakeDb(overrides: {
  sbp?: unknown;
  sarafi?: unknown;
  fallback?: unknown;
} = {}): FakeDb {
  const none = async () => null;
  return {
    sbpDailyFxSnapshot: { findFirst: async () => overrides.sbp ?? null },
    sarafiAfFxDerivedRate: { findFirst: async () => overrides.sarafi ?? null },
    countryFallbackExchangeRate: { findFirst: async () => overrides.fallback ?? null },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    currencyCode: "USD",
    rate: 281.25,
    rateDate: RATE_DATE,
    provider: "SBP_DAILY_FX",
    reference: null,
    db: fakeDb({ sbp: { sellRate: "281.250000" } }),
    ...overrides,
  } as Parameters<typeof assertOpeningFxEvidence>[0];
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OpeningFxEvidenceError, `expected OpeningFxEvidenceError, got ${String(error)}`);
    assert.match((error as Error).message, pattern);
    return true;
  });
}

test("PKR openings need no FX evidence", async () => {
  assert.equal(await assertOpeningFxEvidence(input({ currencyCode: "PKR", rate: 0 })), "SBP_DAILY_FX");
});

test("every provider name is a closed, documented set", () => {
  assert.deepEqual([...OPENING_FX_EVIDENCE_PROVIDERS], [
    "SBP_DAILY_FX",
    "SARAFI_AF_SNAPSHOT",
    "COUNTRY_FALLBACK",
    "MANUAL_HISTORICAL_REMEDIATION",
  ]);
});

test("a provider-backed rate is accepted only when the stored snapshot matches", async () => {
  assert.equal(await assertOpeningFxEvidence(input()), "SBP_DAILY_FX");
  // Spacing/case variations still resolve to the canonical provider.
  assert.equal(await assertOpeningFxEvidence(input({ provider: "sbp daily fx" })), "SBP_DAILY_FX");
});

test("Sarafi and country fallback evidence use the authoritative foreign-to-PKR direction", async () => {
  let sarafiQuery: any;
  let fallbackQuery: any;
  const db = {
    sbpDailyFxSnapshot: { findFirst: async () => null },
    sarafiAfFxDerivedRate: {
      findFirst: async (query: unknown) => {
        sarafiQuery = query;
        return { sellRate: "38.50" };
      },
    },
    countryFallbackExchangeRate: {
      findFirst: async (query: unknown) => {
        fallbackQuery = query;
        return { rate: "38.50" };
      },
    },
  };

  assert.equal(await assertOpeningFxEvidence(input({ currencyCode: "CNY", rate: 38.5, provider: "SARAFI_AF_SNAPSHOT", db })), "SARAFI_AF_SNAPSHOT");
  assert.deepEqual(sarafiQuery.where.fromCurrency, { code: "CNY" });
  assert.deepEqual(sarafiQuery.where.toCurrency, { code: "PKR" });

  assert.equal(await assertOpeningFxEvidence(input({ currencyCode: "CNY", rate: 38.5, provider: "COUNTRY_FALLBACK", db })), "COUNTRY_FALLBACK");
  assert.deepEqual(fallbackQuery.where.fromCurrency, { code: "CNY" });
  assert.deepEqual(fallbackQuery.where.toCurrency, { code: "PKR" });
});

test("a rate that disagrees with stored evidence is rejected, never substituted", async () => {
  await rejects(
    assertOpeningFxEvidence(input({ rate: 300, db: fakeDb({ sbp: { sellRate: "281.250000" } }) })),
    /does not match the stored SBP_DAILY_FX snapshot \(281\.25\)/
  );
});

test("a missing snapshot blocks the opening instead of guessing a rate", async () => {
  await rejects(
    assertOpeningFxEvidence(input({ db: fakeDb({ sbp: null }) })),
    /No stored SBP_DAILY_FX snapshot for USD\/PKR on 2026-03-01/
  );
  await rejects(
    assertOpeningFxEvidence(input({ provider: "SARAFI_AF_SNAPSHOT", db: fakeDb({ sarafi: null }) })),
    /No stored SARAFI_AF_SNAPSHOT snapshot/
  );
  await rejects(
    assertOpeningFxEvidence(input({ provider: "COUNTRY_FALLBACK", db: fakeDb({ fallback: null }) })),
    /No stored COUNTRY_FALLBACK snapshot/
  );
});

test("SBP evidence is only accepted for USD", async () => {
  await rejects(
    assertOpeningFxEvidence(input({ currencyCode: "CNY", db: fakeDb({ sbp: null }) })),
    /No stored SBP_DAILY_FX snapshot for CNY\/PKR/
  );
});

test("an unrecognised provider string cannot supply evidence", async () => {
  await rejects(assertOpeningFxEvidence(input({ provider: "my-broker-quote" })), /Unsupported opening FX evidence provider/);
  await rejects(assertOpeningFxEvidence(input({ provider: "" })), /Unsupported opening FX evidence provider/);
});

test("a manual historical rate requires explicit approval and a documented reference", async () => {
  const base = {
    provider: "MANUAL_HISTORICAL_REMEDIATION",
    rate: 281,
    db: fakeDb(),
  };
  await rejects(
    assertOpeningFxEvidence(input(base)),
    new RegExp(`requires approval confirmation "${MANUAL_HISTORICAL_APPROVAL_PHRASE}"`)
  );
  await rejects(
    assertOpeningFxEvidence(input({ ...base, approval: MANUAL_HISTORICAL_APPROVAL_PHRASE, reference: "  " })),
    /requires a documented evidence reference/
  );
  assert.equal(
    await assertOpeningFxEvidence(
      input({
        ...base,
        approval: MANUAL_HISTORICAL_APPROVAL_PHRASE,
        reference: "Board minute 2026-03-01 / bank confirmation #4471",
      })
    ),
    "MANUAL_HISTORICAL_REMEDIATION"
  );
});

test("an approved manual rate is still not silently trusted for snapshot providers", async () => {
  // Approval only unlocks the manual path; snapshot providers still cross-check.
  await rejects(
    assertOpeningFxEvidence(
      input({ approval: MANUAL_HISTORICAL_APPROVAL_PHRASE, rate: 999, db: fakeDb({ sbp: { sellRate: "281.25" } }) })
    ),
    /does not match the stored SBP_DAILY_FX snapshot/
  );
});

test("non-positive or undated rates are rejected before any lookup", async () => {
  await rejects(assertOpeningFxEvidence(input({ rate: 0 })), /must be greater than zero/);
  await rejects(assertOpeningFxEvidence(input({ rate: -5 })), /must be greater than zero/);
  await rejects(assertOpeningFxEvidence(input({ rate: Number.NaN })), /must be greater than zero/);
  await rejects(assertOpeningFxEvidence(input({ rateDate: new Date("nope") })), /rate date is required/);
});

test("RMB is normalized before evidence is resolved", async () => {
  await rejects(
    assertOpeningFxEvidence(input({ currencyCode: "RMB", provider: "SBP_DAILY_FX", db: fakeDb({ sbp: null }) })),
    /No stored SBP_DAILY_FX snapshot for CNY\/PKR/
  );
});

test("opening route validates evidence and records the normalized provider", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const source = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
  assert.match(source, /assertOpeningFxEvidence/);
  // The client's free-text source must not be stored verbatim as the provider.
  assert.doesNotMatch(source, /fxRateSource: currencyCode === "PKR" \? null : String\(body\.fxRateSource/);
  assert.match(source, /fxRateSource: currencyCode === "PKR" \? null : evidenceProvider/);
});
