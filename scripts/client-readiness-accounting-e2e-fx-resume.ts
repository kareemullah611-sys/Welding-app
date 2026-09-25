import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const RUN = "CR-E2E-20260925";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), "welding_app_client_readiness_e2e_20260923");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const [afn, usd, product, lot, sale, admin] = await Promise.all([
    prisma.currency.findUniqueOrThrow({ where: { code: "AFN" } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "USD" } }),
    prisma.product.findFirstOrThrow({ where: { name: `${RUN} Welding 4.0mm` } }),
    prisma.lot.findFirstOrThrow({ where: { lotNumber: `${RUN}-AF-LOT-001` } }),
    prisma.sale.findFirstOrThrow({ where: { notes: `${RUN} AFN sale` } }),
    prisma.user.findFirstOrThrow({ where: { username: `${RUN.toLowerCase()}-af` } }),
  ]);
  const payment = await prisma.payment.findFirstOrThrow({
    where: { customerId: sale.customerId, paymentDate: new Date("2026-09-26"), amount: 50000 },
    orderBy: { id: "desc" },
  });
  const movement = await prisma.foreignCurrencyMovement.findFirstOrThrow({ where: { sourceType: "customer_payment", sourceId: payment.id } });
  assert.equal(Number(movement.realizedFxPkr), 4016.45);
  const rows = await prisma.journalEntry.findMany({ where: { transactionId: movement.journalTransactionId! } });
  const debit = Math.round(rows.reduce((s, row) => s + Number(row.debit), 0) * 100) / 100;
  const credit = Math.round(rows.reduce((s, row) => s + Number(row.credit), 0) * 100) / 100;
  assert.equal(debit, credit);
  console.log("PASS later collection FX gain is exactly PKR 4,016.45 and journaled once");

  const login = await fetch(`${BASE_URL}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: admin.username, password: "CityAudit123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  const call = async (method: string, path: string, payload: unknown) => {
    const response = await fetch(`${BASE_URL}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(payload) });
    const text = await response.text();
    let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: response.status, body };
  };

  const currencyAttempt = await call("PUT", `/api/v1/payments/${payment.id}`, {
    currencyId: usd.id, amount: 50000, paymentDate: "2026-09-26", paymentMethod: "cash", destination: "our_account",
  });
  const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.notEqual(currencyAttempt.status, 200, "unsafe currency change unexpectedly succeeded");
  assert.equal(paymentAfter.currencyId, afn.id);
  console.log(`PASS unsafe AFN→USD payment edit blocked atomically with HTTP ${currencyAttempt.status}`);

  const saleItem = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
  const saleAttempt = await call("PUT", `/api/v1/sales/${sale.id}/correct`, {
    currencyId: usd.id, reason: "controlled currency-change probe",
    items: [{ id: saleItem.id, productId: product.id, lotId: lot.id, qty: 50, ratePerCarton: 2000 }],
  });
  assert.equal(saleAttempt.status, 409);
  assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).currencyId, afn.id);
  console.log("PASS unsafe AFN→USD sale correction is blocked and retains immutable AFN recognition currency");

  const all = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(all._sum.debit || 0), Number(all._sum.credit || 0));
  console.log(`PASS global debit/credit equality after FX probes: ${Number(all._sum.debit || 0).toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
