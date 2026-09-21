import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createIntermediaryExchange } from "@/app/api/v1/intermediaries/[id]/exchanges/route";
import { foreignCurrencyOwnerKey, recordForeignCurrencyRecognition } from "@/lib/foreign-currency-carrying-db";

test("intermediary exchange create is idempotent for repeated sync request id", async () => {
  const marker = `sync-int-exchange-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const usd = await prisma.currency.findFirst({ where: { code: "USD" } });
  const pkr = await prisma.currency.findFirst({ where: { code: "PKR" } });
  assert.ok(usd, "Seed currency USD is required");
  assert.ok(pkr, "Seed currency PKR is required");

  const intermediary = await prisma.intermediary.create({
    data: { name: marker, notes: "sync test" },
  });
  const bank = await prisma.superAdminBankAccount.create({
    data: {
      bankName: `${marker}-bank`,
      accountNumber: marker,
      currencyId: usd.id,
      createdBy: superAdmin.id,
      isActive: true,
    },
  });

  await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId: intermediary.id,
      depositDate: new Date("2026-04-27"),
      amount: 500,
      currencyId: usd.id,
      sourceType: "super_admin_bank_account",
      cityId: null,
      bankAccountId: null,
      superAdminBankAccountId: bank.id,
      notes: `${marker}-seed`,
      createdBy: superAdmin.id,
    },
  });
  const seedLayer = await prisma.$transaction((tx) => recordForeignCurrencyRecognition(tx, {
    positionKind: "asset",
    positionType: "intermediary_balance",
    ownerKey: foreignCurrencyOwnerKey.intermediary(intermediary.id),
    currencyCode: "USD",
    sourceType: "test_intermediary_exchange_funding",
    sourceId: intermediary.id,
    recognitionDate: new Date("2026-04-27"),
    historicalPoolDate: new Date("2026-04-27"),
    foreignAmount: 500,
    carryingAmountPkr: 140000,
    rate: { ratePkr: 280, rateType: "test", provider: "LOCAL_TEST" },
    createdBy: superAdmin.id,
  }));
  let createdExchangeId: number | null = null;

  const syncRequestId = `req-int-exchange-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    exchangeDate: "2026-04-27",
    baseCurrencyId: usd.id,
    quoteCurrencyId: pkr.id,
    fromCurrencyId: usd.id,
    fromAmount: 100,
    toCurrencyId: pkr.id,
    exchangeRate: 280,
    notes: marker,
  };

  try {
    const firstRequest = new NextRequest(`http://localhost/api/v1/intermediaries/${intermediary.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createIntermediaryExchange(firstRequest, { params: { id: String(intermediary.id) } });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");
    createdExchangeId = firstId;

    const secondRequest = new NextRequest(`http://localhost/api/v1/intermediaries/${intermediary.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createIntermediaryExchange(secondRequest, { params: { id: String(intermediary.id) } });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same intermediary exchange");

    const createdRows = await prisma.intermediaryExchange.findMany({
      where: { intermediaryId: intermediary.id, notes: marker },
    });
    assert.equal(createdRows.length, 1, "Only one intermediary exchange row should exist for replayed request");
  } finally {
    if (createdExchangeId) {
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "intermediary_exchange", sourceId: createdExchangeId } });
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "intermediary_exchange_target", sourceId: createdExchangeId } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { sourceType: "intermediary_exchange_target", sourceId: createdExchangeId } });
    }
    await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "test_intermediary_exchange_funding", sourceId: intermediary.id } });
    await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: seedLayer.id } });
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "intermediary_exchanges",
        requestId: syncRequestId,
      },
    });
    await prisma.intermediaryExchange.deleteMany({
      where: { intermediaryId: intermediary.id, notes: marker },
    });
    await prisma.intermediaryDeposit.deleteMany({
      where: { intermediaryId: intermediary.id, notes: `${marker}-seed` },
    });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: bank.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
  }
});
