import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_FINANCIAL_PAGE_SIZE,
  fetchInBatches,
  getLedgerPaginationParams,
  paginateList,
} from "@/lib/pagination";

test("financial pagination enforces a server-side maximum", () => {
  assert.ok(MAX_FINANCIAL_PAGE_SIZE > 0 && MAX_FINANCIAL_PAGE_SIZE < 10000);

  const sp = new URLSearchParams("page=1&limit=999999");
  assert.equal(getLedgerPaginationParams(sp).limit, MAX_FINANCIAL_PAGE_SIZE);
  assert.equal(paginateList([], 1, 999999).pagination.limit, MAX_FINANCIAL_PAGE_SIZE);
});

test("financial pagination rejects negative, zero and non-numeric input", () => {
  for (const query of ["page=0&limit=-5", "page=abc&limit=abc", "page=-3&limit=0"]) {
    const { page, limit } = getLedgerPaginationParams(new URLSearchParams(query));
    assert.ok(page >= 1, `page must be >= 1 for ${query}`);
    assert.ok(limit >= 1, `limit must be >= 1 for ${query}`);
  }
});

test("fetchInBatches returns every row while never exceeding the batch size", async () => {
  const total = 1250;
  const seen: number[] = [];
  let largestQuery = 0;

  const rows = await fetchInBatches<number>(100, async (take, skip) => {
    largestQuery = Math.max(largestQuery, take);
    const batch = [];
    for (let i = skip; i < Math.min(skip + take, total); i += 1) batch.push(i);
    seen.push(...batch);
    return batch;
  });

  assert.equal(rows.length, total, "batched read must return the complete dataset");
  assert.equal(largestQuery, 100, "no single query may exceed the batch size");
  assert.deepEqual(seen, Array.from({ length: total }, (_, i) => i), "rows must arrive in order without gaps");
});

test("fetchInBatches stops when a batch is short instead of issuing an extra query", async () => {
  let calls = 0;
  const rows = await fetchInBatches<number>(10, async (take, skip) => {
    calls += 1;
    return Array.from({ length: Math.min(take, 3) }, (_, i) => skip + i);
  });
  assert.equal(rows.length, 3);
  assert.equal(calls, 1);
});

test("fetchInBatches handles an empty dataset", async () => {
  const rows = await fetchInBatches<number>(50, async () => []);
  assert.deepEqual(rows, []);
});

test("payments endpoint has no unbounded all=1 read", () => {
  const source = readFileSync("src/app/api/v1/payments/route.ts", "utf8");
  assert.doesNotMatch(source, /fetchAll/);
  assert.doesNotMatch(source, /searchParams\.get\("all"\)/);
  // Pagination must always be applied to the query.
  assert.match(source, /skip,\s*\n\s*take: limit/);
});

test("reports export reads every dataset through bounded batches", () => {
  const source = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");
  assert.match(source, /import \{ fetchInBatches \} from "@\/lib\/pagination"/);
  assert.match(source, /const EXPORT_BATCH_SIZE = \d+/);

  // Every read must go through the batched closure and carry take/skip.
  const reads = source.match(/fetchInBatches\(EXPORT_BATCH_SIZE, \(take, skip\) => prisma\.[A-Za-z]+\.findMany\(\{/g) || [];
  assert.ok(reads.length >= 17, `expected all export reads batched, found ${reads.length}`);

  const unbatched = source.match(/(?<!fetchInBatches\(EXPORT_BATCH_SIZE, \(take, skip\) => )prisma\.[A-Za-z]+\.findMany\(\{/g) || [];
  assert.deepEqual(unbatched, [], `export must not use unbounded findMany; found ${unbatched.join(", ")}`);

  const batchedQueries = source.match(/fetchInBatches\(EXPORT_BATCH_SIZE,[\s\S]*?\}\)\)/g) || [];
  assert.ok(batchedQueries.length >= 17, "expected every export dataset to use a deterministic batched query");
  for (const query of batchedQueries) {
    assert.match(query, /orderBy:[\s\S]*?id/, "every offset-paginated export query must include a unique id tie-breaker");
  }
});

test("finance combined clamps page and limit so NaN cannot reach the response", () => {
  const source = readFileSync("src/app/api/v1/finance/combined/route.ts", "utf8");
  assert.match(source, /MAX_FINANCIAL_PAGE_SIZE/);
  assert.doesNotMatch(source, /parseInt\(sp\.get\("page"\) \|\| "1"\)\)\s*;/);
  assert.match(source, /Number\.isFinite\(pageRaw\)/);
  assert.match(source, /Number\.isFinite\(limitRaw\)/);
});
