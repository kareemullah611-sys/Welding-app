import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/v1/lots/[id]/distribute/route.ts", "utf8");

test("lot distribution replacement is atomic and removes only unused godown assignments", () => {
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /lotCityGodownAllocation\.deleteMany/);
  assert.match(route, /saleItem\.count/);
  assert.match(route, /cityTransfer\.count/);
  assert.match(route, /DISTRIBUTION_HAS_MOVEMENTS/);
});

test("lot distribution reduction cannot fall below existing godown assignments", () => {
  assert.match(route, /DISTRIBUTION_BELOW_GODOWN_ASSIGNMENTS/);
});
