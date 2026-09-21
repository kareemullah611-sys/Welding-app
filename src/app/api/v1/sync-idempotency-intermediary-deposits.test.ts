import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createIntermediaryDeposit } from "@/app/api/v1/intermediaries/[id]/deposits/route";
import { foreignCurrencyOwnerKey, recordForeignCurrencyRecognition } from "@/lib/foreign-currency-carrying-db";

test("intermediary deposit create is idempotent for repeated sync request id", async () => {
  const marker = `sync-int-deposit-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const currency = await prisma.currency.findFirst({ where: { code: "USD" } });
  assert.ok(currency, "Seed currency USD is required");

  const intermediary = await prisma.intermediary.create({
    data: { name: marker, notes: "sync test" },
  });
  const bank = await prisma.superAdminBankAccount.create({
    data: {
      bankName: `${marker}-bank`,
      accountNumber: marker,
      currencyId: currency.id,
      createdBy: superAdmin.id,
      isActive: true,
    },
  });
  const seedLayer = await prisma.$transaction((tx) => recordForeignCurrencyRecognition(tx, {
    positionKind: "asset",
    positionType: "super_admin_bank",
    ownerKey: foreignCurrencyOwnerKey.superAdminBank(bank.id),
    currencyCode: "USD",
    sourceType: "test_intermediary_deposit_funding",
    sourceId: bank.id,
    recognitionDate: new Date("2026-04-27"),
    historicalPoolDate: new Date("2026-04-27"),
    foreignAmount: 1200,
    carryingAmountPkr: 338400,
    rate: { ratePkr: 282, rateType: "test", provider: "LOCAL_TEST" },
    createdBy: superAdmin.id,
  }));
  let createdDepositId: number | null = null;

  const syncRequestId = `req-int-deposit-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    depositDate: "2026-04-27",
    amount: 1200,
    currencyId: currency.id,
    superAdminBankAccountId: bank.id,
    notes: marker,
  };

  try {
    const firstRequest = new NextRequest(`http://localhost/api/v1/intermediaries/${intermediary.id}/deposits`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createIntermediaryDeposit(firstRequest, { params: { id: String(intermediary.id) } });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");
    createdDepositId = firstId;

    const secondRequest = new NextRequest(`http://localhost/api/v1/intermediaries/${intermediary.id}/deposits`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createIntermediaryDeposit(secondRequest, { params: { id: String(intermediary.id) } });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same intermediary deposit");

    const createdRows = await prisma.intermediaryDeposit.findMany({
      where: { intermediaryId: intermediary.id, notes: marker },
    });
    assert.equal(createdRows.length, 1, "Only one intermediary deposit row should exist for replayed request");
  } finally {
    if (createdDepositId) {
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "intermediary_deposit", sourceId: createdDepositId } });
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "intermediary_deposit_target", sourceId: createdDepositId } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { sourceType: "intermediary_deposit_target", sourceId: createdDepositId } });
    }
    await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "test_intermediary_deposit_funding", sourceId: bank.id } });
    await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: seedLayer.id } });
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "intermediary_deposits",
        requestId: syncRequestId,
      },
    });
    await prisma.intermediaryDeposit.deleteMany({
      where: { intermediaryId: intermediary.id, notes: marker },
    });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: bank.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
  }
});
