import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createShippingLinePayment } from "@/app/api/v1/shipping-line-payments/route";

test("shipping line payment create is idempotent for repeated sync request id", async () => {
  const marker = `sync-shipping-payment-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const shippingLine = await prisma.shippingLine.create({
    data: { name: marker, notes: "sync test" },
  });
  const intermediary = await prisma.intermediary.create({
    data: { name: `${marker}-int`, notes: "sync test" },
  });
  const [country, city, usd] = await Promise.all([
    prisma.country.findUnique({ where: { code: "PK" } }),
    prisma.city.findFirst({ where: { country: { code: "PK" } } }),
    prisma.currency.findUnique({ where: { code: "USD" } }),
  ]);
  assert.ok(country && city && usd, "Pakistan, USD, and a Pakistan city are required");
  const lot = await prisma.lot.create({
    data: {
      countryId: country.id,
      lotNumber: `${marker}-lot`,
      lotDate: new Date("2026-04-20"),
      pkrExchangeRate: 280,
      status: "ongoing",
      createdBy: superAdmin.id,
    },
  });
  const freight = await prisma.lotCost.create({
    data: {
      lotId: lot.id,
      costType: "freight",
      description: marker,
      amount: 5000,
      currencyCode: "USD",
      exchangeRate: 280,
      costDate: new Date("2026-04-20"),
      shippingLineId: shippingLine.id,
      createdBy: superAdmin.id,
    },
  });
  const deposit = await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId: intermediary.id,
      depositDate: new Date("2026-04-21"),
      amount: 5000,
      currencyId: usd.id,
      sourceType: "city_cash",
      cityId: city.id,
      createdBy: superAdmin.id,
    },
  });
  const layer = await prisma.intermediaryUsdCostLayer.create({
    data: {
      intermediaryId: intermediary.id,
      currencyId: usd.id,
      sourceType: "sync_test_shipping",
      sourceId: deposit.id,
      acquiredDate: new Date("2026-04-21"),
      originalAmountUsd: 5000,
      remainingAmountUsd: 5000,
      originalCostPkr: 1410000,
      remainingCostPkr: 1410000,
      ratePkr: 282,
    },
  });

  const syncRequestId = `req-shipping-payment-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    shippingLineId: shippingLine.id,
    lotId: lot.id,
    paymentDate: "2026-04-27",
    amountUsd: 4321,
    reference: "sync-test",
    notes: "offline replay test",
    intermediaryId: intermediary.id,
    settlementCurrency: "USD",
    exchangeRate: 282,
  };
  let createdPaymentId: number | null = null;

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/shipping-line-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createShippingLinePayment(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");
    createdPaymentId = firstId;

    const secondRequest = new NextRequest("http://localhost/api/v1/shipping-line-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createShippingLinePayment(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same shipping line payment");

    const createdRows = await prisma.shippingLinePayment.findMany({
      where: {
        shippingLineId: shippingLine.id,
        reference: "sync-test",
      },
    });
    assert.equal(createdRows.length, 1, "Only one shipping line payment row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "shipping_line_payments",
        requestId: syncRequestId,
      },
    });
    if (createdPaymentId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "shipping_line_payments", entityId: createdPaymentId } });
      await prisma.journalEntry.deleteMany({ where: { entityType: "shipping_line_payment", entityId: createdPaymentId } });
    }
    await prisma.shippingLinePayment.deleteMany({ where: { shippingLineId: shippingLine.id, reference: "sync-test" } });
    await prisma.intermediaryUsdCostLayer.deleteMany({ where: { id: layer.id } });
    await prisma.intermediaryDeposit.deleteMany({ where: { id: deposit.id } });
    await prisma.lotCost.deleteMany({ where: { id: freight.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
    await prisma.shippingLine.deleteMany({ where: { id: shippingLine.id } });
  }
});
