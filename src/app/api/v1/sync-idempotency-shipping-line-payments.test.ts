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

  const syncRequestId = `req-shipping-payment-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    shippingLineId: shippingLine.id,
    paymentDate: "2026-04-27",
    amountUsd: 4321,
    reference: "sync-test",
    notes: "offline replay test",
    intermediaryId: intermediary.id,
  };

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
    await prisma.shippingLinePayment.deleteMany({ where: { shippingLineId: shippingLine.id, reference: "sync-test" } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
    await prisma.shippingLine.deleteMany({ where: { id: shippingLine.id } });
  }
});
