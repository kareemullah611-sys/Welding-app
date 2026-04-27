import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createAgent } from "@/app/api/v1/agents/route";

test("agent create is idempotent for repeated sync request id", async () => {
  const marker = `sync-agent-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta is required");

  const syncRequestId = `req-agent-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = { name: marker, agentType: "customs", cityId: city.id, notes: "offline replay test" };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/agents", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createAgent(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/agents", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createAgent(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same agent");

    const createdRows = await prisma.agent.findMany({ where: { name: marker } });
    assert.equal(createdRows.length, 1, "Only one agent row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "agents",
        requestId: syncRequestId,
      },
    });
    await prisma.agent.deleteMany({ where: { name: marker } });
  }
});
