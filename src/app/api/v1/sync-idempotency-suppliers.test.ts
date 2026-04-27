import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createSupplier } from "@/app/api/v1/suppliers/route";

test("supplier create is idempotent for repeated sync request id", async () => {
  const marker = `sync-supplier-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const syncRequestId = `req-supplier-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    name: marker,
    country: "China",
    contact: "sync-test",
    notes: "offline replay test",
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/suppliers", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createSupplier(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/suppliers", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createSupplier(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same supplier");

    const createdRows = await prisma.supplier.findMany({ where: { name: marker } });
    assert.equal(createdRows.length, 1, "Only one supplier row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "suppliers",
        requestId: syncRequestId,
      },
    });
    await prisma.supplier.deleteMany({ where: { name: marker } });
  }
});
