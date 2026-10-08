import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";

const source = readFileSync(join(process.cwd(), "src/lib/offline-sync-hydrate.ts"), "utf8");

test("cached page-1 rows match the page size declared in the cached pagination", () => {
  const pagedBlock = source.slice(source.indexOf("Common paginated request shape"), source.indexOf("await prefetchGodownStockCaches"));

  const rowSlice = pagedBlock.match(/data: rows\.slice\(0,\s*([^)]+)\)/);
  assert.ok(rowSlice, "expected the paged cache row to be sliced from rows");
  assert.notEqual(
    rowSlice[1].trim(),
    "20",
    "cached page-1 payload must not use a hardcoded row count that differs from the declared limit"
  );
  assert.match(
    pagedBlock,
    /data: rows\.slice\(0,\s*DEFAULT_LIST_PAGE_SIZE\)/,
    "cached page-1 payload must be sliced with DEFAULT_LIST_PAGE_SIZE"
  );
});

test("cached totalPages is consistent with the declared page size", () => {
  const pagedBlock = source.slice(source.indexOf("Common paginated request shape"), source.indexOf("await prefetchGodownStockCaches"));
  assert.match(
    pagedBlock,
    /Math\.ceil\(rows\.length \/ DEFAULT_LIST_PAGE_SIZE\)/,
    "totalPages must be computed from the same page size the rows are sliced with"
  );
});
