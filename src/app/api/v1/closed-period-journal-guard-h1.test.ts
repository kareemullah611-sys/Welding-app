import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createPayment } from "@/app/api/v1/payments/route";
import { PUT as updatePayment } from "@/app/api/v1/payments/[id]/route";

test("H1: editing a payment out of a closed financial year must not delete closed-period journals", async () => {
  const marker = `h1-closed-${Date.now()}`;
  const closedPaymentDate = "2026-04-24";
  const fyStart = new Date("2026-04-01");
  const fyEnd = new Date("2026-05-31");
  const openPaymentDate = new Date().toISOString().split("T")[0]!;

  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: pkr.id } },
    update: {},
    create: { cityId: city.id, currencyId: pkr.id },
  });
  const customer = await prisma.customer.create({
    data: { cityId: city.id, name: `${marker}-customer`, isActive: true },
  });
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-03-01"), status: "ongoing", createdBy: user.id },
  });
  await prisma.lotCityDistribution.create({ data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 50 } });
  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  let paymentId = 0;
  try {
    const createRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          paymentDate: closedPaymentDate,
          amount: 777000,
          currencyId: pkr.id,
          paymentMethod: "cash",
          destination: "our_account",
          detail: marker,
        }),
      }),
      { params: {} }
    );
    const createJson = (await createRes.json()) as any;
    assert.equal(createRes.status, 201, `payment create failed: ${JSON.stringify(createJson)}`);
    paymentId = createJson.data.id;
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "seed precondition: PAY journal");

    await prisma.financialYear.deleteMany({ where: { startDate: fyStart, endDate: fyEnd } });
    const fy = await prisma.financialYear.create({
      data: { name: marker, startDate: fyStart, endDate: fyEnd, status: "closed", createdBy: user.id },
    });

    const editRes = await updatePayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ paymentDate: openPaymentDate }),
      }),
      { params: { id: String(paymentId) } }
    );
    const editJson = (await editRes.json()) as any;
    assert.ok(
      editRes.status >= 400,
      `closed-period journals must not be rewritten — edit must fail, got ${editRes.status}: ${JSON.stringify(editJson)}`
    );

    const payRows = await prisma.journalEntry.findMany({
      where: { transactionId: `PAY-${paymentId}` },
      select: { entryDate: true },
    });
    assert.equal(payRows.length, 2, "PAY journal rows must survive the blocked edit");
    for (const row of payRows) {
      assert.equal(
        new Date(row.entryDate).toISOString().split("T")[0],
        closedPaymentDate,
        "closed-period PAY journal rows must remain untouched"
      );
    }

    await prisma.financialYear.delete({ where: { id: fy.id } });
  } finally {
    await prisma.financialYear.deleteMany({ where: { name: marker } });
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`PAY-${paymentId}`, `REV-PAY-${paymentId}`] } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "payments", entityId: paymentId } });
    await prisma.payment.deleteMany({ where: { id: paymentId || -1 } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}` } });
    await prisma.lotCityDistribution.deleteMany({ where: { lotId: lot.id } });
    await prisma.lot.delete({ where: { id: lot.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }
});
