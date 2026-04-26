import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createWithdrawal } from "@/app/api/v1/personal-withdrawals/route";

test("personal withdrawal create is idempotent for repeated sync request id", async () => {
  const marker = `sync-withdrawal-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const cityCurrency = await prisma.cityCurrency.findFirst({
    where: { cityId: city.id },
    orderBy: { currencyId: "asc" },
  });
  assert.ok(cityCurrency, "At least one city currency is required for Quetta");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  const syncRequestId = `req-withdrawal-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    withdrawalDate: "2026-04-26",
    amount: 12345,
    currencyId: cityCurrency.currencyId,
    detail: marker,
    withdrawnBy: "sync test",
    notes: "offline replay test",
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/personal-withdrawals", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createWithdrawal(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/personal-withdrawals", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createWithdrawal(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same withdrawal");

    const createdRows = await prisma.personalWithdrawal.findMany({
      where: { cityId: city.id, detail: marker },
    });
    assert.equal(createdRows.length, 1, "Only one withdrawal row should exist for replayed request");
  } finally {
    await prisma.personalWithdrawal.deleteMany({
      where: { cityId: city.id, detail: marker },
    });
  }
});
