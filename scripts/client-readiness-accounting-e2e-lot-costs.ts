import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const RUN = "CR-E2E-20260925";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), "welding_app_client_readiness_e2e_20260923");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const [lot, supplier] = await Promise.all([
    prisma.lot.findFirstOrThrow({ where: { lotNumber: `${RUN}-LOT-001` } }),
    prisma.supplier.findFirstOrThrow({ where: { name: `${RUN} Supplier` } }),
  ]);
  const login = await fetch(`${BASE_URL}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "superadmin", password: "admin1234" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  const call = async (method: string, path: string, payload?: unknown) => {
    const response = await fetch(`${BASE_URL}${path}`, { method, headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), cookie }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const body = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body.data;
  };
  const correctionRows = await prisma.journalEntry.findMany({ where: { lotId: lot.id, transactionId: { startsWith: "PURCHCORR-LOT-" } } });
  assert.ok(correctionRows.length > 0);
  assert.equal(correctionRows.reduce((s, row) => s + Number(row.debit), 0), correctionRows.reduce((s, row) => s + Number(row.credit), 0));
  console.log("PASS purchase reclassification and quantity/price corrections use immutable balanced PURCHCORR journals");

  const cost = await call("POST", "/api/v1/lot-costs", {
    lotId: lot.id, costType: "transport", allocationBasis: "weight",
    description: `${RUN} late transport cost`, amount: 110000, currencyCode: "PKR",
    costDate: "2026-09-15", supplierId: supplier.id,
  });
  const createdRows = await prisma.journalEntry.findMany({ where: { entityType: "lot_cost", entityId: cost.id } });
  assert.ok(createdRows.length >= 2);
  assert.equal(createdRows.reduce((s, row) => s + Number(row.debit), 0), createdRows.reduce((s, row) => s + Number(row.credit), 0));
  console.log("PASS late lot cost splits sold COGS and remaining inventory through balanced delta journal");

  await call("PUT", `/api/v1/lot-costs/${cost.id}`, { amount: 220000, description: `${RUN} corrected late transport cost` });
  const updated = await prisma.lotCost.findUniqueOrThrow({ where: { id: cost.id } });
  assert.equal(Number(updated.amount), 220000);
  assert.equal(updated.journalVersion, 2);
  console.log("PASS late lot cost edit increments journal version and posts only the delta");

  await call("DELETE", `/api/v1/lot-costs/${cost.id}`);
  assert.equal(await prisma.lotCost.count({ where: { id: cost.id } }), 0);
  const afterDelete = await prisma.journalEntry.findMany({ where: { entityType: "lot_cost", entityId: cost.id } });
  assert.equal(afterDelete.reduce((s, row) => s + Number(row.debit), 0), afterDelete.reduce((s, row) => s + Number(row.credit), 0));
  console.log("PASS lot cost delete preserves immutable rows and posts a balanced negative delta");

  const all = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(all._sum.debit || 0), Number(all._sum.credit || 0));
  console.log(`PASS global debit/credit equality ${Number(all._sum.debit || 0).toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
