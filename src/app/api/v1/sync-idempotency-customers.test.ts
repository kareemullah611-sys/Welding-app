import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createCustomer } from "@/app/api/v1/customers/route";

test("customer create is idempotent for repeated sync request id", async () => {
  const marker = `sync-customer-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  const syncRequestId = `req-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    cityId: city.id,
    name: marker,
    phone: "03001234567",
    address: "offline test",
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/customers", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createCustomer(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/customers", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createCustomer(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same customer");

    const createdRows = await prisma.customer.findMany({
      where: { cityId: city.id, name: marker },
    });
    assert.equal(createdRows.length, 1, "Only one customer row should exist for replayed request");
  } finally {
    await prisma.customer.deleteMany({
      where: { cityId: city.id, name: marker },
    });
  }
});
