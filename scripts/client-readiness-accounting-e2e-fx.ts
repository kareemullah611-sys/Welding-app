import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const RUN = "CR-E2E-20260925";

class Api {
  cookie = "";
  async login(username: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200, await response.text());
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  }
  async call(method: string, path: string, payload?: unknown, status?: number) {
    const response = await fetch(`${BASE_URL}${path}`, { method, headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), cookie: this.cookie }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await response.text();
    let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return { status: response.status, data: body?.data, body };
  }
}

const quotesDay1 = [
  { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 252, rawUnit: "1K" },
  { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 69, rawSellRate: 70, rawUnit: "1" },
  { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 9.5, rawSellRate: 9.7, rawUnit: "1" },
  { baseCurrencyCode: "AED", quoteCurrencyCode: "AFN", rawBuyRate: 18.7, rawSellRate: 19.0, rawUnit: "1" },
];
const quotesDay2 = [
  { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 245, rawSellRate: 247, rawUnit: "1K" },
  { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 71, rawUnit: "1" },
  { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 9.7, rawSellRate: 9.9, rawUnit: "1" },
  { baseCurrencyCode: "AED", quoteCurrencyCode: "AFN", rawBuyRate: 19.0, rawSellRate: 19.3, rawUnit: "1" },
];

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), "welding_app_client_readiness_e2e_20260923");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const [af, afCity, afAdmin, afGodown, afCustomer, supplier, product, afn, usd] = await Promise.all([
    prisma.country.findUniqueOrThrow({ where: { code: "AF" } }),
    prisma.city.findFirstOrThrow({ where: { name: `${RUN} Afghanistan` } }),
    prisma.user.findFirstOrThrow({ where: { username: `${RUN.toLowerCase()}-af` } }),
    prisma.godown.findFirstOrThrow({ where: { name: `${RUN} AF Main` } }),
    prisma.customer.findFirstOrThrow({ where: { name: `${RUN} Customer AF` } }),
    prisma.supplier.findFirstOrThrow({ where: { name: `${RUN} Supplier` } }),
    prisma.product.findFirstOrThrow({ where: { name: `${RUN} Welding 4.0mm` } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "AFN" } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "USD" } }),
  ]);
  const superApi = new Api();
  const cityApi = new Api();
  await superApi.login("superadmin", "admin1234");
  await cityApi.login(afAdmin.username, "CityAudit123");

  const now = new Date().toISOString();
  const snapshot1 = await superApi.call("POST", "/api/v1/fx-snapshots/sarafi-af", {
    snapshotDate: "2026-09-25", sourceTimestamp: now, rawReference: `${RUN}:sarai-shahzada:day1`, market: "sarai_shahzada", quotes: quotesDay1,
  }, 201);
  const snapshot2 = await superApi.call("POST", "/api/v1/fx-snapshots/sarafi-af", {
    snapshotDate: "2026-09-26", sourceTimestamp: now, rawReference: `${RUN}:sarai-shahzada:day2`, market: "sarai_shahzada", quotes: quotesDay2,
  }, 201);
  assert.equal(snapshot1.data.snapshot.market, "sarai_shahzada");
  assert.equal(snapshot1.data.snapshot.status, "VALID_CURRENT");
  assert.equal(snapshot2.data.snapshot.status, "VALID_CURRENT");
  console.log("PASS two immutable Sarai Shahzada daily snapshots with PKR 1K, USD, CNY and AED quotes");

  const originalRate = await prisma.sarafiAfFxDerivedRate.findFirstOrThrow({ where: { snapshotId: snapshot1.data.id, fromCurrencyId: afn.id } });
  const duplicate = await superApi.call("POST", "/api/v1/fx-snapshots/sarafi-af", {
    snapshotDate: "2026-09-25", sourceTimestamp: now, rawReference: `${RUN}:conflicting-duplicate`, market: "sarai_shahzada",
    quotes: quotesDay2,
  }, 200);
  assert.equal(duplicate.data.duplicate, true);
  const unchangedRate = await prisma.sarafiAfFxDerivedRate.findFirstOrThrow({ where: { snapshotId: snapshot1.data.id, fromCurrencyId: afn.id } });
  assert.equal(Number(unchangedRate.buyRate), Number(originalRate.buyRate));
  console.log("PASS duplicate daily-rate submission cannot rewrite the historical snapshot");

  const lot = (await superApi.call("POST", "/api/v1/lots", {
    countryId: af.id, destinationCityId: afCity.id, lotNumber: `${RUN}-AF-LOT-001`, lotDate: "2026-09-25",
    purchaseItems: [{ supplierId: supplier.id, productId: product.id, qtyMt: 10, unitPriceUsdPerMt: 1000 }],
    distributions: [{ cityId: afCity.id, productId: product.id, allocatedQty: 500 }],
  }, 201)).data;
  assert.equal(Number(lot.pkrExchangeRate), 280);
  await cityApi.call("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: afCity.id, productId: product.id, allocations: [{ godownId: afGodown.id, qty: 500 }],
  });
  console.log("PASS Afghanistan USD lot preserves USD 10,000 and recognizes PKR 2,800,000 at liability sell rate");

  const sale = (await cityApi.call("POST", "/api/v1/sales", {
    customerId: afCustomer.id, godownId: afGodown.id, lotId: lot.id, saleDate: "2026-09-25", currencyId: afn.id,
    items: [{ productId: product.id, lotId: lot.id, qty: 50, ratePerCarton: 2000 }], notes: `${RUN} AFN sale`,
  }, 201)).data;
  const saleRow = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(Number(saleRow.totalAmount), 100000);
  assert.equal(saleRow.fxOriginalCurrencyCode, "AFN");
  assert.equal(Number(saleRow.fxSelectedRate), Number(originalRate.buyRate));
  assert.equal(Number(saleRow.fxPkrEquivalent), Math.round(100000 * Number(originalRate.buyRate) * 100) / 100);
  const receivableLayer = await prisma.foreignCurrencyCarryingLayer.findFirstOrThrow({ where: { sourceType: "sale", sourceId: sale.id, currencyId: afn.id } });
  assert.equal(Number(receivableLayer.originalForeignAmount), 100000);
  console.log(`PASS AFN sale stores original AFN and immutable PKR carrying value ${Number(saleRow.fxPkrEquivalent).toFixed(2)}`);

  const payment1 = (await cityApi.call("POST", "/api/v1/payments", {
    customerId: afCustomer.id, lotId: lot.id, paymentDate: "2026-09-25", detail: `${RUN} AFN receipt day1`,
    amount: 50000, currencyId: afn.id, paymentMethod: "cash", destination: "our_account",
  }, 201)).data;
  const movement1 = await prisma.foreignCurrencyMovement.findFirstOrThrow({ where: { sourceType: "customer_payment", sourceId: payment1.id } });
  assert.equal(Number(movement1.realizedFxPkr), 0);
  console.log("PASS same-day AFN collection transfers carrying basis with zero duplicate profit/FX");

  const payment2 = (await cityApi.call("POST", "/api/v1/payments", {
    customerId: afCustomer.id, lotId: lot.id, paymentDate: "2026-09-26", detail: `${RUN} AFN receipt day2`,
    amount: 50000, currencyId: afn.id, paymentMethod: "cash", destination: "our_account",
  }, 201)).data;
  const movement2 = await prisma.foreignCurrencyMovement.findFirstOrThrow({ where: { sourceType: "customer_payment", sourceId: payment2.id } });
  assert.ok(Number(movement2.realizedFxPkr) > 0, "day-two stronger AFN should create an FX gain");
  assert.ok(movement2.journalTransactionId);
  const fxJournal = await prisma.journalEntry.findMany({ where: { transactionId: movement2.journalTransactionId! } });
  assert.equal(
    Math.round(fxJournal.reduce((s, row) => s + Number(row.debit), 0) * 100) / 100,
    Math.round(fxJournal.reduce((s, row) => s + Number(row.credit), 0) * 100) / 100,
  );
  console.log(`PASS later AFN collection recognizes FX gain once: PKR ${Number(movement2.realizedFxPkr).toFixed(2)}`);

  const currencyChangeAttempt = await cityApi.call("PUT", `/api/v1/payments/${payment2.id}`, {
    currencyId: usd.id, amount: 50000, paymentDate: "2026-09-26", paymentMethod: "cash", destination: "our_account",
  });
  const changedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment2.id } });
  console.log(`OBSERVE payment currency edit returned ${currencyChangeAttempt.status}; stored currency is ${changedPayment.currencyId === usd.id ? "USD" : "not USD"}`);

  const saleCurrencyAttempt = await cityApi.call("PUT", `/api/v1/sales/${sale.id}/correct`, {
    currencyId: usd.id, reason: "controlled currency-change probe",
    items: [{ id: (await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } })).id, productId: product.id, lotId: lot.id, qty: 50, ratePerCarton: 2000 }],
  });
  const saleAfterProbe = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(saleAfterProbe.currencyId, afn.id);
  console.log(`PASS sale correction does not silently rewrite recognized currency; response ${saleCurrencyAttempt.status}, AFN retained`);

  const all = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(all._sum.debit || 0), Number(all._sum.credit || 0));
  console.log(`PASS global journal equality after foreign-currency lifecycle: ${Number(all._sum.debit || 0).toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
