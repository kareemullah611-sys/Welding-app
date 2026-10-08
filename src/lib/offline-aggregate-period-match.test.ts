import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The analytics / profit-report aggregate readers must not answer a request for one
 * period or year with another period's cached numbers. These assertions are on the
 * source because the branch bodies are unreachable from a unit test: the guarded
 * "mismatch" path returned the same payload as the matching path.
 */
const source = readFileSync(join(process.cwd(), "src/lib/offline-aggregate-prefetch.ts"), "utf8");

test("analytics does not fall back to a cached snapshot from a different period/year", () => {
  const analyticsBlock = source.slice(
    source.indexOf('path === "/api/v1/analytics"'),
    source.indexOf('path === "/api/v1/profit-report"')
  );

  assert.ok(
    !/Fall back to any cached analytics snapshot/.test(analyticsBlock),
    "analytics must return null for an uncached period/year instead of another year's totals"
  );
  assert.match(
    analyticsBlock,
    /cached\.period !== reqPeriod \|\| cached\.year !== reqYear\) return null/,
    "analytics must fall through to null on period/year mismatch"
  );
});

test("profit-report does not return a cached year for a different requested year", () => {
  const block = source.slice(
    source.indexOf('path === "/api/v1/profit-report"'),
    source.indexOf('path === "/api/v1/search"')
  );

  assert.match(
    block,
    /Number\(params\.year\) !== Number\(cached\.year\)\) return null;/,
    "a requested year that differs from the cached year must return null"
  );
  assert.ok(
    !/Number\(params\.year\) === Number\(cached\.year\)\) return \{ data: cached\.data as T \};\s*\n\s*return \{ data: cached\.data as T \};/.test(block),
    "a year match and a year mismatch must not both return the same cached payload"
  );
  assert.match(block, /cached\.dateFrom/, "the date range is part of the snapshot identity");
  assert.match(block, /cached\.dateTo/, "the date range is part of the snapshot identity");
});
