import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { generateToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GET as getFinanceCombined } from "@/app/api/v1/finance/combined/route";
import { GET as getSales } from "@/app/api/v1/sales/route";

test("search by amount-column numeric text matches payments and sales", async () => {
  const marker = `amt-search-${Date.now()}`;

  const country = await prisma.country.findUnique({ where: { code: "PK" } });
  assert.ok(country, "Seed country PK is required for this test");

  const city = await prisma.city.create({
    data: { name: `${marker}-city`, countryId: country.id },
    include: { country: true },
  });

  const currency = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(currency, "Seed currency PKR is required for this test");

  const user = await prisma.user.create({
    data: {
      username: `${marker}-admin`,
      passwordHash: "test-only-not-for-login",
      fullName: `${marker} Admin`,
      role: "city_admin",
      cityId: city.id,
      isActive: true,
    },
  });
  const godown = await prisma.godown.create({
    data: { cityId: city.id, name: `${marker}-godown`, isActive: true },
  });

  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: currency.id } },
    update: {},
    create: { cityId: city.id, currencyId: currency.id },
  });

  const product = await prisma.product.create({
    data: { name: `${marker}-product`, isActive: true },
  });
  const customer = await prisma.customer.create({
    data: { cityId: city.id, name: `${marker}-customer`, isActive: true },
  });
  const lot = await prisma.lot.create({
    data: {
      countryId: city.countryId,
      lotNumber: `${marker}-lot`,
      lotDate: new Date("2026-04-01"),
      status: "ongoing",
      createdBy: user.id,
    },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: {
      lotId: lot.id,
      cityId: city.id,
      productId: product.id,
      allocatedQty: 100,
    },
  });
  await prisma.lotCityGodownAllocation.create({
    data: {
      lotCityDistributionId: distribution.id,
      godownId: godown.id,
      productId: product.id,
      qty: 100,
    },
  });

  const sale = await prisma.sale.create({
    data: {
      cityId: city.id,
      customerId: customer.id,
      lotId: lot.id,
      godownId: godown.id,
      voucherNo: `${Math.floor(Math.random() * 9000 + 1000)}`,
      saleDate: new Date("2026-04-10"),
      totalAmount: 1234.56,
      currencyId: currency.id,
      status: "active",
      createdBy: user.id,
      items: {
        create: [{ productId: product.id, lotId: lot.id, qty: 2, ratePerCarton: 617.28, amount: 1234.56 }],
      },
    },
  });

  const payment = await prisma.payment.create({
    data: {
      cityId: city.id,
      customerId: customer.id,
      lotId: lot.id,
      paymentDate: new Date("2026-04-11"),
      detail: `${marker}-payment`,
      amount: 789.12,
      currencyId: currency.id,
      paymentMethod: "cash",
      destination: "our_account",
      status: "active",
      createdBy: user.id,
    },
  });

  try {
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: "city_admin",
      cityId: city.id,
      countryId: city.countryId,
    });

    const authHeaders = { authorization: `Bearer ${token}` };

    const salesRequest = new NextRequest("http://localhost/api/v1/sales?q=1234&page=1&limit=20", {
      headers: authHeaders,
    });
    const salesResponse = await getSales(salesRequest, { params: {} });
    const salesJson = (await salesResponse.json()) as any;
    assert.equal(salesResponse.status, 200);
    assert.equal(salesJson.success, true);
    assert.equal(
      salesJson.data.some((item: any) => item.id === sale.id),
      true,
      "Sale should match when searching amount-column numeric text (1234)",
    );

    const paymentsRequest = new NextRequest(
      "http://localhost/api/v1/finance/combined?q=789&type=payment&page=1&limit=20",
      { headers: authHeaders },
    );
    const paymentsResponse = await getFinanceCombined(paymentsRequest, { params: {} });
    const paymentsJson = (await paymentsResponse.json()) as any;
    assert.equal(paymentsResponse.status, 200);
    assert.equal(paymentsJson.success, true);
    assert.equal(
      paymentsJson.data.some((item: any) => item.id === payment.id && item.type === "payment"),
      true,
      "Payment should match when searching amount-column numeric text (789)",
    );
  } finally {
    await prisma.payment.deleteMany({ where: { id: payment.id } });
    await prisma.sale.deleteMany({ where: { id: sale.id } });
    await prisma.lotCityGodownAllocation.deleteMany({ where: { lotCityDistributionId: distribution.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.cityCurrency.deleteMany({ where: { cityId: city.id } });
    await prisma.godown.deleteMany({ where: { id: godown.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.city.deleteMany({ where: { id: city.id } });
  }
});
