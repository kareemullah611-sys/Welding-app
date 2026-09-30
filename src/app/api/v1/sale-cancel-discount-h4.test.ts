import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { getCustomerAccountId, getSalesRevenueAccountId } from "@/lib/accounting";
import { POST as applyDiscount } from "@/app/api/v1/sales/[id]/discount/route";
import { PUT as cancelSale } from "@/app/api/v1/sales/[id]/cancel/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function scopedNet(accountId: number, transactionIds: string[]): Promise<number> {
  const rows = await prisma.journalEntry.findMany({
    where: { accountId, transactionId: { in: transactionIds } },
    select: { debit: true, credit: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0);
}

test("H4: cancelling a discounted sale reverses the DISCOUNT journals too", async () => {
  const marker = `h4-${Date.now()}`;
  const voucherNo = `H4${String(Date.now() % 1e8).padStart(8, "0")}`;
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(admin, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  const customer = await prisma.customer.create({ data: { cityId: city.id, name: `${marker}-customer`, isActive: true } });
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-godown`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: admin.id },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 100 },
  });
  const sale = await prisma.sale.create({
    data: {
      cityId: city.id,
      customerId: customer.id,
      lotId: lot.id,
      godownId: godown.id,
      voucherNo,
      saleDate: new Date("2026-04-15"),
      totalAmount: 1000,
      currencyId: pkr.id,
      status: "active",
      createdBy: admin.id,
    },
  });
  const arAccount = await getCustomerAccountId(customer.id);
  const revenueAccount = await getSalesRevenueAccountId();
  await prisma.journalEntry.createMany({
    data: [
      { transactionId: `SALE-${sale.id}`, lineNumber: 1, accountId: arAccount, debit: 1000, credit: 0, currencyCode: "PKR", description: "H4 seed sale", entityType: "sale", entityId: sale.id, lotId: lot.id, cityId: city.id, entryDate: new Date("2026-04-15"), createdBy: admin.id },
      { transactionId: `SALE-${sale.id}`, lineNumber: 2, accountId: revenueAccount, debit: 0, credit: 1000, currencyCode: "PKR", description: "H4 seed sale", entityType: "sale", entityId: sale.id, lotId: lot.id, cityId: city.id, entryDate: new Date("2026-04-15"), createdBy: admin.id },
    ],
  });

  const saleIds = [sale.id];
  const discountIds: number[] = [];
  try {
    const discountRes = await applyDiscount(
      new NextRequest(`http://localhost/api/v1/sales/${sale.id}/discount`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ discountAmount: 200, discountDate: "2026-04-24", notes: marker }),
      }),
      { params: { id: String(sale.id) } }
    );
    const discountJson = (await discountRes.json()) as any;
    assert.equal(discountRes.status, 200, `discount create failed: ${JSON.stringify(discountJson)}`);
    const discountId = discountJson.data.id;
    assert.ok(Number.isInteger(discountId), `discount id missing: ${JSON.stringify(discountJson)}`);
    discountIds.push(discountId);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `DISCOUNT-${discountId}` } }), 2, "seed precondition: DISCOUNT journal exists");

    const cancelRes = await cancelSale(
      new NextRequest(`http://localhost/api/v1/sales/${sale.id}/cancel`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ reason: "H4 discount reversal test" }),
      }),
      { params: { id: String(sale.id) } }
    );
    const cancelJson = (await cancelRes.json()) as any;
    assert.equal(cancelRes.status, 200, `cancel failed: ${JSON.stringify(cancelJson)}`);

    const cancelled = await prisma.sale.findUnique({ where: { id: sale.id }, select: { status: true } });
    assert.equal(cancelled?.status, "cancelled", "sale must be cancelled");

    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `REV-DISCOUNT-${discountId}` } }),
      2,
      "cancelling must reverse the DISCOUNT journal (REV-DISCOUNT pair)"
    );

    const arTxns = [`SALE-${sale.id}`, `REV-SALE-${sale.id}`, `DISCOUNT-${discountId}`, `REV-DISCOUNT-${discountId}`];
    assert.equal(await scopedNet(arAccount, arTxns), 0, "customer AR net must be zero after cancelling a discounted sale");
    assert.equal(await scopedNet(revenueAccount, arTxns), 0, "sales revenue net must be zero after cancelling a discounted sale");
  } finally {
    const txnIds = [
      ...saleIds.map((id) => [`SALE-${id}`, `REV-SALE-${id}`, `COGS-${id}`, `REV-COGS-${id}`]).flat(),
      ...discountIds.map((id) => [`DISCOUNT-${id}`, `REV-DISCOUNT-${id}`]).flat(),
    ];
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: txnIds } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: sale.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sale_discounts", entityId: { in: discountIds } } });
    if (discountIds.length) await prisma.saleDiscount.deleteMany({ where: { id: { in: discountIds } } });
    await prisma.sale.deleteMany({ where: { id: sale.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.godown.deleteMany({ where: { id: godown.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
    await prisma.product.deleteMany({ where: { id: product.id } });
  }
});
