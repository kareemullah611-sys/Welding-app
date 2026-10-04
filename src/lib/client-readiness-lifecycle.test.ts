import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inter-godown transfers expose an immutable audited reversal endpoint", () => {
  const route = readFileSync("src/app/api/v1/godowns/transfers/[id]/reverse/route.ts", "utf8");
  assert.match(route, /export const POST/);
  assert.match(route, /fromGodownId:\s*original\.toGodownId/);
  assert.match(route, /toGodownId:\s*original\.fromGodownId/);
  assert.match(route, /"godown_transfers"[^\n]*"cancel"/);
  assert.doesNotMatch(route, /godownTransfer\.delete/);
});

test("superadmin liability accounts support metadata edit and controlled deactivation", () => {
  const route = readFileSync("src/app/api/v1/super-admin-liabilities/[id]/route.ts", "utf8");
  assert.match(route, /export const PUT/);
  assert.match(route, /export const DELETE/);
  assert.match(route, /isActive:\s*false/);
  assert.doesNotMatch(route, /superAdminLiabilityAccount\.delete/);
});

test("browser coverage exercises both complete lifecycles", () => {
  const spec = readFileSync("e2e/client-readiness-lifecycles.spec.ts", "utf8");
  assert.match(spec, /inter-godown transfer.*reversal restores stock/is);
  assert.match(spec, /superadmin liability.*create.*payment.*reversal/is);
  assert.match(spec, /getByRole\("button", \{ name: "Inter-Godown" \}\)/);
  assert.match(spec, /getByRole\("button", \{ name: "Edit account" \}\)/);
  assert.match(spec, /getByRole\("button", \{ name: "Deactivate account" \}\)/);
});
