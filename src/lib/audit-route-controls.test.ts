import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sale discount persists discount, total, journal, and audit in one transaction", () => {
  const route = readFileSync("src/app/api/v1/sales/[id]/discount/route.ts", "utf8");
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(route, /tx\.saleDiscount\.create/);
  assert.match(route, /tx\.sale\.update/);
  assert.match(route, /journalSaleDiscount\([\s\S]*, tx\)/);
  assert.match(route, /createAuditLog\([\s\S]*, tx\)/);
});

test("payment hard-delete removes linked Haji transfer and journals inside the same transaction", () => {
  const route = readFileSync("src/app/api/v1/payments/[id]/hard-delete/route.ts", "utf8");
  assert.match(route, /tx\.hajiTransfer\.findMany/);
  assert.match(route, /paymentId:\s*id/);
  assert.match(route, /chequePaymentId:\s*id/);
  assert.match(route, /`HAJI-\$\{transfer\.id\}`/);
  assert.match(route, /tx\.hajiTransfer\.deleteMany/);
  assert.match(route, /createAuditLog\([\s\S]*, tx\)/);
});

test("assistant financial date filters use an exclusive next-day boundary", () => {
  const source = readFileSync("src/app/api/v1/assistant/route.ts", "utf8");
  assert.doesNotMatch(source, /T23:59:59/);
  assert.doesNotMatch(source, /lte:\s*to/);
  assert.match(source, /lt:\s*toExclusive/);
});
