import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("stock ledger godown transfer out keeps the UNION movement shape", () => {
  const route = readFileSync("src/app/api/v1/inventory/stock-ledger/route.ts", "utf8");
  const start = route.indexOf("-- 4. GODOWN TRANSFER OUT (within city)", route.indexOf("const rows"));
  const end = route.indexOf("-- 5. GODOWN TRANSFER IN (within city)", start);
  const branch = route.slice(start, end);

  assert.ok(start >= 0 && end > start, "godown transfer out movement branch should exist");
  assert.match(branch, /0\s+AS qty_in,/);
  assert.match(branch, /gt\.qty\s+AS qty_out,/);
});
