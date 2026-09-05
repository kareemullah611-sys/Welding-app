import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createAgentPayment } from "@/app/api/v1/agent-payments/route";

test("agent payment create is idempotent for repeated sync request id", async () => {
  const marker = `sync-agent-payment-${Date.now()}`;
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
  assert.ok(city, "Seed city Quetta (PK) is required");
  const fundingAccount = await prisma.bankAccount.create({
    data: {
      cityId: city.id,
      bankName: `${marker}-bank`,
      accountNumber: marker,
    },
  });

  const agent = await prisma.agent.create({
    data: {
      name: marker,
      agentType: "customs",
      cityId: city.id,
      notes: "sync test",
    },
  });

  const syncRequestId = `req-agent-payment-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    agentId: agent.id,
    cityId: city.id,
    paymentDate: "2026-04-27",
    amount: 5555,
    currencyCode: "PKR",
    paymentMethod: "cash",
    reference: "sync-test",
    notes: "offline replay test",
    bankAccountId: fundingAccount.id,
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/agent-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createAgentPayment(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/agent-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createAgentPayment(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same agent payment");

    const createdRows = await prisma.agentPayment.findMany({
      where: { agentId: agent.id, reference: "sync-test" },
    });
    assert.equal(createdRows.length, 1, "Only one agent payment row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "agent_payments",
        requestId: syncRequestId,
      },
    });
    await prisma.agentPayment.deleteMany({ where: { agentId: agent.id, reference: "sync-test" } });
    await prisma.agent.deleteMany({ where: { id: agent.id } });
    await prisma.bankAccount.deleteMany({ where: { id: fundingAccount.id } });
  }
});
