import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateCustomerPortalToken } from "@/lib/customer-portal-auth";
import { journalSaleCreated, journalPaymentReceived, journalSaleDiscount, getCustomerAccountId } from "@/lib/accounting";
import { GET as portalLedger } from "@/app/api/v1/customer-portal/ledger/route";

test("M3: portal ledger shows sale discounts and nets equal to the GL AR", async () => {
  const marker = `m3-${Date.now()}`;
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(admin, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");

  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-godown`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: admin.id },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 10 },
  });
  const allocation = await prisma.lotCityGodownAllocation.create({
    data: { lotCityDistributionId: distribution.id, godownId: godown.id, productId: product.id, qty: 10 },
  });
  const valuation = await prisma.openingInventoryValuation.create({
    data: { lotId: lot.id, productId: product.id, quantity: 10, unitCostPkr: 50, totalValuePkr: 500, openingDate: new Date("2026-04-01"), createdBy: admin.id },
  });
  const customer = await prisma.customer.create({
    data: {
      cityId: city.id,
      name: `${marker}-customer`,
      isActive: true,
      portalAccessEnabled: true,
      portalUsername: marker,
      portalPasswordHash: "x",
    },
  });

  const saleDate = new Date("2026-04-24");
  const voucherNo = `M3${String(Date.now() % 1e7).padStart(7, "0")}`;
  let saleId = 0;
  let discId = 0;
  let paymentId = 0;
  try {
    const sale = await prisma.sale.create({
      data: {
        cityId: city.id, customerId: customer.id, lotId: lot.id, godownId: godown.id,
        voucherNo, saleDate, totalAmount: 450, currencyId: pkr.id, createdBy: admin.id,
        items: { create: [{ lotId: lot.id, productId: product.id, qty: 5, ratePerCarton: 100, amount: 500 }] },
      },
    });
    saleId = sale.id;
    const disc = await prisma.saleDiscount.create({
      data: { saleId, discountAmount: 50, currencyId: pkr.id, appliedToLotId: lot.id, notes: `${marker}-disc`, discountDate: saleDate, createdBy: admin.id },
    });
    discId = disc.id;
    const payment = await prisma.payment.create({
      data: {
        cityId: city.id, customerId: customer.id, lotId: lot.id, saleId,
        paymentDate: saleDate, detail: `${marker}-payment`, amount: 450, currencyId: pkr.id,
        paymentMethod: "cash", destination: "our_account", createdBy: admin.id,
      },
    });
    paymentId = payment.id;

    await journalSaleCreated({ id: saleId, customerId: customer.id, cityId: city.id, lotId: lot.id, totalAmount: 500, currencyCode: "PKR", saleDate, createdBy: admin.id });
    await journalSaleDiscount({ id: discId, saleId, customerId: customer.id, cityId: city.id, lotId: lot.id, amount: 50, currencyCode: "PKR", discountDate: saleDate, createdBy: admin.id });
    await journalPaymentReceived({ id: paymentId, customerId: customer.id, cityId: city.id, lotId: lot.id, amount: 450, currencyCode: "PKR", paymentDate: saleDate, createdBy: admin.id });

    const arAccount = await getCustomerAccountId(customer.id);
    const glRows = await prisma.journalEntry.findMany({
      where: { accountId: arAccount, transactionId: { in: [`SALE-${saleId}`, `DISCOUNT-${discId}`, `PAY-${paymentId}`] } },
      select: { debit: true, credit: true },
    });
    const glAr = Math.round((glRows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0)) * 100) / 100;
    assert.equal(glAr, 0, "seed precondition: GL AR nets to zero (500 - 50 - 450)");

    const portalToken = generateCustomerPortalToken({ customerId: customer.id, cityId: city.id, username: marker, type: "customer_portal" });
    const res = await portalLedger(
      new NextRequest("http://localhost/api/v1/customer-portal/ledger", {
        headers: { cookie: `customer_portal_token=${portalToken}` },
      })
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 200, `portal ledger must be served: ${JSON.stringify(json)}`);

    const discountRows = (json.data.ledger as any[]).filter((t) => t.type === "discount");
    assert.equal(discountRows.length, 1, "portal ledger must include the sale discount as a credit row");
    assert.equal(Number(discountRows[0].credit), 50, "discount row credits 50");
    assert.equal(Number(discountRows[0].debit), 0, "discount row has no debit");

    const portalBalance = Number(json.data.balanceByCurrency.PKR || 0);
    assert.equal(portalBalance, glAr, `portal balance (${portalBalance}) must equal GL AR (${glAr})`);
  } finally {
    const txnIds = [`SALE-${saleId}`, `DISCOUNT-${discId}`, `PAY-${paymentId}`, `REV-PAY-${paymentId}`];
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: txnIds } } });
    if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
    if (discId) await prisma.saleDiscount.deleteMany({ where: { id: discId } });
    if (saleId) {
      await prisma.saleItem.deleteMany({ where: { saleId } });
      await prisma.sale.deleteMany({ where: { id: saleId } });
    }
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.openingInventoryValuation.deleteMany({ where: { id: valuation.id } });
    await prisma.lotCityGodownAllocation.deleteMany({ where: { id: allocation.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.godown.deleteMany({ where: { id: godown.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
  }
});
