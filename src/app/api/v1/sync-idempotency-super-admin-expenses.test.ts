import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createExpense } from "@/app/api/v1/super-admin-personal-expenses/route";

test("super-admin personal expense create is idempotent for repeated sync request id", async () => {
  const marker = `sync-home-expense-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const currency = await prisma.currency.findFirst({ orderBy: { id: "asc" } });
  assert.ok(currency, "At least one active currency is required");

  const bankAccount = await prisma.superAdminBankAccount.create({
    data: {
      bankName: marker,
      accountNumber: `${Date.now()}`,
      currencyId: currency.id,
      createdBy: superAdmin.id,
    },
  });

  const syncRequestId = `req-home-expense-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    expenseDate: "2026-04-27",
    amount: 777,
    detail: marker,
    notes: "offline replay test",
    bankAccountId: bankAccount.id,
  };

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/super-admin-personal-expenses", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createExpense(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");

    const secondRequest = new NextRequest("http://localhost/api/v1/super-admin-personal-expenses", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createExpense(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same super-admin expense");

    const createdRows = await prisma.superAdminPersonalExpense.findMany({
      where: { detail: marker, bankAccountId: bankAccount.id, deletedAt: null },
    });
    assert.equal(createdRows.length, 1, "Only one super-admin expense row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "super_admin_personal_expenses",
        requestId: syncRequestId,
      },
    });
    await prisma.superAdminPersonalExpense.deleteMany({
      where: { detail: marker, bankAccountId: bankAccount.id },
    });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: bankAccount.id } });
  }
});
