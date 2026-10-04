import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const openings = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const depositRoute = readFileSync("src/app/api/v1/bank-deposits/route.ts", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");
const customerLedger = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
const portalLedger = readFileSync("src/app/api/v1/customer-portal/ledger/route.ts", "utf8");
const reportExport = readFileSync("src/app/api/v1/reports/export/route.ts", "utf8");

test("opening cheques are customer-owned in-hand instruments", () => {
  const model = schema.slice(schema.indexOf("model OpeningCheque"), schema.indexOf("model OpeningInventoryValuation"));
  assert.match(model, /customerId\s+Int/);
  assert.match(model, /chequeStatus\s+ChequeStatus\s+@default\(in_hand\)/);
  assert.match(model, /bankDepositId\s+Int\?/);
  assert.match(openings, /customerId/);
  assert.match(page, /Customer who issued the cheque/);
  assert.doesNotMatch(accounting.slice(accounting.indexOf("export async function journalOpeningCheque"), accounting.indexOf("export async function journalOpeningChequeBounced")), /getCustomerAccountId/);
});

test("bank deposits consume opening cheques without creating payment copies", () => {
  assert.match(depositRoute, /openingChequeIds/);
  assert.match(depositRoute, /openingCheque\.updateMany/);
  assert.match(accounting, /openingChequeId/);
  assert.doesNotMatch(openings, /payment\.create/);
});

test("an opening cheque has an audited bounce path back to customer receivable", () => {
  const bounce = readFileSync("src/app/api/v1/opening-cheques/[id]/bounce/route.ts", "utf8");
  assert.match(bounce, /user\.role !== "city_admin" && user\.role !== "super_admin"/);
  assert.match(bounce, /chequeStatus:\s*"bounced"/);
  assert.match(bounce, /journalOpeningChequeBounced/);
  assert.match(accounting, /Opening cheque bounced/);
});

test("a bounce is a debit in admin, portal, and exported customer ledgers", () => {
  for (const source of [customerLedger, portalLedger, reportExport]) {
    assert.match(source, /openingCheque\.findMany/);
    assert.match(source, /Opening cheque bounced/);
    assert.match(source, /cheque_bounce/);
  }
});
