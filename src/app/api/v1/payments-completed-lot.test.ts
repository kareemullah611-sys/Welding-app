import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createPayment } from "@/app/api/v1/payments/route";

test("city admin can record payment against a completed lot distributed to their city", async () => {
  const marker = `completed-lot-pay-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required for this test");

  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: pkr.id } },
    update: {},
    create: { cityId: city.id, currencyId: pkr.id },
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
      status: "completed",
      createdBy: user.id,
      completedBy: user.id,
      completedAt: new Date("2026-04-20"),
    },
  });

  const distribution = await prisma.lotCityDistribution.create({
    data: {
      lotId: lot.id,
      cityId: city.id,
      productId: product.id,
      allocatedQty: 20,
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

    const request = new NextRequest("http://localhost/api/v1/payments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        customerId: customer.id,
        lotId: lot.id,
        paymentDate: "2026-04-24",
        detail: `${marker}-payment`,
        amount: 5000,
        currencyId: pkr.id,
        paymentMethod: "cash",
        destination: "our_account",
      }),
    });

    const response = await createPayment(request, { params: {} });
    const json = (await response.json()) as any;

    assert.equal(response.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.data?.lot?.id, lot.id);
  } finally {
    await prisma.payment.deleteMany({ where: { detail: `${marker}-payment` } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
  }
});
