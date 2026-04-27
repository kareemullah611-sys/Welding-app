import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createIntermediary } from "@/app/api/v1/intermediaries/route";

test("intermediary create is idempotent for repeated sync request id", async () => {
  const marker = `sync-intermediary-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const syncRequestId = `req-intermediary-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    name: marker,
    notes: "offline replay test",
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/intermediaries", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createIntermediary(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/intermediaries", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createIntermediary(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same intermediary");

    const createdRows = await prisma.intermediary.findMany({ where: { name: marker } });
    assert.equal(createdRows.length, 1, "Only one intermediary row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "intermediaries",
        requestId: syncRequestId,
      },
    });
    await prisma.intermediary.deleteMany({ where: { name: marker } });
  }
});
