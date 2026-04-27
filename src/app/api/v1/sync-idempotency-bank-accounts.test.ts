import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createBankAccount } from "@/app/api/v1/bank-accounts/route";

test("super-admin bank account create is idempotent for repeated sync request id", async () => {
  const marker = `sync-sa-bank-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const pkr = await prisma.currency.findFirst({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const syncRequestId = `req-sa-bank-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = { bankName: marker, accountNumber: marker, currencyId: pkr.id };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/bank-accounts", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createBankAccount(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/bank-accounts", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createBankAccount(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same bank account");

    const createdRows = await prisma.superAdminBankAccount.findMany({ where: { bankName: marker } });
    assert.equal(createdRows.length, 1, "Only one bank account row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "bank_accounts",
        requestId: syncRequestId,
      },
    });
    await prisma.superAdminBankAccount.deleteMany({ where: { bankName: marker } });
  }
});
