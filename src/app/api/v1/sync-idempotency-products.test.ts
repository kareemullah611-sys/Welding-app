import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createProduct } from "@/app/api/v1/products/route";

test("product create is idempotent for repeated sync request id", async () => {
  const marker = `sync-product-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const syncRequestId = `req-product-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = { name: marker };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/products", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createProduct(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/products", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createProduct(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same product");

    const createdRows = await prisma.product.findMany({ where: { name: marker } });
    assert.equal(createdRows.length, 1, "Only one product row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "products",
        requestId: syncRequestId,
      },
    });
    await prisma.product.deleteMany({ where: { name: marker } });
  }
});
