import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const DB = "welding_app_client_readiness_e2e_20260923";
const RUN = process.env.E2E_RUN_ID || "CR-E2E-20260925";

class Api {
  cookie = "";
  async login(username: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200, await response.text());
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  }
  async call(method: string, path: string, data?: unknown, status?: number) {
    const response = await fetch(`${BASE_URL}${path}`, { method, headers: { ...(data === undefined ? {} : { "content-type": "application/json" }), cookie: this.cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text();
    let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body?.data;
  }
}

function sum(lines: Array<{ debit: unknown; credit: unknown }>) {
  return {
    debit: lines.reduce((total, line) => total + Number(line.debit), 0),
    credit: lines.reduce((total, line) => total + Number(line.credit), 0),
  };
}

async function assertBalanced(transactionId: string) {
  const lines = await prisma.journalEntry.findMany({ where: { transactionId } });
  assert.ok(lines.length >= 2, `${transactionId} has no complete journal`);
  const total = sum(lines);
  assert.equal(total.debit, total.credit, `${transactionId} is unbalanced`);
  return total.debit;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), DB);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));

  const [city, product, replacement, lot, customer, supplier, pkr, godown] = await Promise.all([
    prisma.city.findFirstOrThrow({ where: { name: `${RUN} Pakistan A` } }),
    prisma.product.findFirstOrThrow({ where: { name: `${RUN} Welding 3.2mm` } }),
    prisma.product.findFirstOrThrow({ where: { name: `${RUN} Welding 4.0mm` } }),
    prisma.lot.findFirstOrThrow({ where: { lotNumber: `${RUN}-LOT-001` } }),
    prisma.customer.findFirstOrThrow({ where: { name: `${RUN} Customer A` } }),
    prisma.supplier.findFirstOrThrow({ where: { name: `${RUN} Supplier` } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } }),
    prisma.godown.findFirstOrThrow({ where: { name: `${RUN} A Main` } }),
  ]);
  const purchase = await prisma.lotPurchase.findFirstOrThrow({ where: { lotId: lot.id, productId: product.id } });

  const cityApi = new Api();
  const superApi = new Api();
  await cityApi.login(`${RUN.toLowerCase()}-pk-a`, "CityAudit123");
  await superApi.login("superadmin", "admin1234");

  const sale = await cityApi.call("POST", "/api/v1/sales", {
    customerId: customer.id,
    godownId: godown.id,
    lotId: lot.id,
    saleDate: "2026-09-13",
    currencyId: pkr.id,
    notes: `${RUN} controlled sale`,
    items: [{ productId: product.id, lotId: lot.id, qty: 100, ratePerCarton: 7000 }],
  }, 201);
  assert.equal(Number(sale.totalAmount), 700_000);
  assert.equal(await assertBalanced(`SALE-${sale.id}`), 700_000);
  assert.equal(await assertBalanced(`COGS-${sale.id}`), 566_000);
  console.log("PASS PKR sale: revenue 700,000; COGS 566,000; gross profit 134,000");

  const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
  await cityApi.call("PUT", `/api/v1/sales/${sale.id}/correct`, {
    saleDate: "2026-09-14",
    reason: "controlled quantity and price correction",
    items: [{ id: item.id, productId: product.id, lotId: lot.id, qty: 120, ratePerCarton: 7200 }],
  });
  const correctedSale = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
  assert.equal(Number(correctedSale.totalAmount), 864_000);
  assert.equal(Number(correctedSale.items[0].qty), 120);
  assert.equal(await assertBalanced(`SALE-${sale.id}`), 864_000);
  assert.equal(await assertBalanced(`COGS-${sale.id}`), 679_200);
  assert.equal(await prisma.journalEntry.count({ where: { transactionId: { in: [`REV-SALE-${sale.id}`, `REV-COGS-${sale.id}`] } } }), 0);
  console.log("PASS sale edit replaces journals: revenue 864,000; COGS 679,200; gross profit 184,800");

  await superApi.call("PUT", `/api/v1/lots/${lot.id}`, {
    purchaseItems: [{ id: purchase.id, supplierId: supplier.id, productId: replacement.id, qtyMt: 20, unitPriceUsdPerMt: 1000 }],
    productReclassifications: [{ fromProductId: product.id, toProductId: replacement.id }],
  });
  const [reclassedSaleItem, oldDistributionCount, newDistributionCount, oldTransferCount, newTransferCount] = await Promise.all([
    prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } }),
    prisma.lotCityDistribution.count({ where: { lotId: lot.id, productId: product.id } }),
    prisma.lotCityDistribution.count({ where: { lotId: lot.id, productId: replacement.id } }),
    prisma.cityTransfer.count({ where: { lotId: lot.id, productId: product.id } }),
    prisma.cityTransfer.count({ where: { lotId: lot.id, productId: replacement.id } }),
  ]);
  assert.equal(reclassedSaleItem.productId, replacement.id);
  assert.equal(oldDistributionCount, 0);
  assert.ok(newDistributionCount > 0);
  assert.equal(oldTransferCount, 0);
  assert.ok(newTransferCount > 0);
  console.log("PASS product reclassification updates sale, distributions, assignments and transfers end to end");

  await superApi.call("PUT", `/api/v1/lots/${lot.id}`, {
    purchaseItems: [{ id: purchase.id, supplierId: supplier.id, productId: replacement.id, qtyMt: 22, unitPriceUsdPerMt: 1100 }],
  });
  const updatedPurchase = await prisma.lotPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
  const updatedLotProduct = await prisma.lotProduct.findUniqueOrThrow({ where: { lotId_productId: { lotId: lot.id, productId: replacement.id } } });
  assert.equal(Number(updatedPurchase.totalPriceUsd), 24_200);
  assert.equal(Number(updatedLotProduct.totalQty), 1100);
  const correctionRows = await prisma.journalEntry.findMany({ where: { lotId: lot.id, transactionId: { startsWith: "PURCHCORR-LOT-" } } });
  assert.ok(correctionRows.length > 0, "purchase correction did not create immutable delta journal");
  const correctionTotals = sum(correctionRows);
  assert.equal(correctionTotals.debit, correctionTotals.credit);
  console.log(`PASS post-sale purchase quantity/price correction: USD 24,200; 1,100 cartons; delta journal balanced at ${correctionTotals.debit}`);

  const cost = await superApi.call("POST", "/api/v1/lot-costs", {
    lotId: lot.id,
    costType: "transport",
    allocationBasis: "weight",
    description: `${RUN} late transport cost`,
    amount: 110_000,
    currencyCode: "PKR",
    costDate: "2026-09-15",
    supplierId: supplier.id,
  }, 201);
  const costCreateRows = await prisma.journalEntry.findMany({ where: { entityType: "lot_cost", entityId: cost.id } });
  assert.ok(costCreateRows.length >= 2);
  assert.equal(sum(costCreateRows).debit, sum(costCreateRows).credit);
  console.log("PASS late lot cost creates balanced inventory/COGS correction without rewriting original journals");

  await superApi.call("PUT", `/api/v1/lot-costs/${cost.id}`, { amount: 220_000, description: `${RUN} corrected late transport cost` });
  const updatedCost = await prisma.lotCost.findUniqueOrThrow({ where: { id: cost.id } });
  assert.equal(Number(updatedCost.amount), 220_000);
  assert.equal(updatedCost.journalVersion, 2);
  console.log("PASS late lot cost edit posts a versioned delta");

  await superApi.call("DELETE", `/api/v1/lot-costs/${cost.id}`);
  assert.equal(await prisma.lotCost.count({ where: { id: cost.id } }), 0);
  const costRowsAfterDelete = await prisma.journalEntry.findMany({ where: { entityType: "lot_cost", entityId: cost.id } });
  assert.equal(sum(costRowsAfterDelete).debit, sum(costRowsAfterDelete).credit);
  assert.equal(costRowsAfterDelete.reduce((total, row) => total + Number(row.debit) - Number(row.credit), 0), 0);
  console.log("PASS late lot cost deletion posts reversing delta and preserves journal audit rows");

  const all = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(all._sum.debit || 0), Number(all._sum.credit || 0));
  console.log(`PASS global journal equality after sale/lot/cost corrections: ${Number(all._sum.debit || 0).toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
