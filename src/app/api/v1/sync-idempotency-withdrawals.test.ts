import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createWithdrawal } from "@/app/api/v1/personal-withdrawals/route";
import { POST as approveWithdrawal } from "@/app/api/v1/personal-withdrawals/[id]/approve/route";
import { computeOngoingLotHajiOwedForCity } from "@/lib/ongoing-lot-haji-owed";
import { GET as getCashPosition } from "@/app/api/v1/cash-position/route";

test("personal withdrawal create is idempotent for repeated sync request id", async () => {
  const marker = `sync-withdrawal-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const cityCurrency = await prisma.cityCurrency.findFirst({
    where: { cityId: city.id, currency: { code: "PKR" } },
  });
  assert.ok(cityCurrency, "PKR must be configured for Quetta");

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
  let createdWithdrawalId: number | null = null;
  let createdHajiTransferId: number | null = null;

  const readCashPosition = async () => {
    const request = new NextRequest("http://localhost/api/v1/cash-position", {
      headers: { authorization: `Bearer ${token}` },
    });
    const response = await getCashPosition(request, { params: {} });
    const json = (await response.json()) as any;
    assert.equal(response.status, 200);
    return Number(json.data.netCashInHand);
  };

  const liabilityBefore = Number((await computeOngoingLotHajiOwedForCity(city.id)).PKR || 0);
  const cashBefore = await readCashPosition();

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
    createdWithdrawalId = firstId;

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
    assert.ok(createdRows[0].hajiTransferId, "Withdrawal should link one Haji transfer atomically");
    createdHajiTransferId = createdRows[0].hajiTransferId;

    const linkedTransfers = await prisma.hajiTransfer.findMany({
      where: { id: createdHajiTransferId!, paymentId: null },
    });
    assert.equal(linkedTransfers.length, 1, "Exactly one linked Haji transfer should exist");
    assert.equal(Number(linkedTransfers[0].amount), payload.amount);

    const journalEntries = await prisma.journalEntry.findMany({
      where: { transactionId: `HAJI-${createdHajiTransferId}` },
    });
    assert.equal(journalEntries.length, 2, "PKR withdrawal should create one balanced Haji journal");
    assert.equal(
      journalEntries.reduce((sum, entry) => sum + Number(entry.debit) - Number(entry.credit), 0),
      0,
      "Withdrawal journal must balance",
    );

    const liabilityAfterCreate = Number((await computeOngoingLotHajiOwedForCity(city.id)).PKR || 0);
    const cashAfterCreate = await readCashPosition();
    assert.equal(liabilityAfterCreate, liabilityBefore - payload.amount, "Withdrawal should reduce city liability once");
    assert.equal(cashAfterCreate, cashBefore - payload.amount, "Withdrawal should reduce office cash once");

    const superAdmin = await prisma.user.findFirst({ where: { role: "super_admin", isActive: true } });
    assert.ok(superAdmin, "An active superadmin is required for approval verification");
    const superToken = generateToken({
      userId: superAdmin.id,
      username: superAdmin.username,
      role: "super_admin",
      cityId: null,
      countryId: null,
    });
    const approveRequest = new NextRequest(`http://localhost/api/v1/personal-withdrawals/${firstId}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${superToken}` },
    });
    const approveResponse = await approveWithdrawal(approveRequest, { params: { id: String(firstId) } });
    assert.equal(approveResponse.status, 200);
    assert.equal(Number((await computeOngoingLotHajiOwedForCity(city.id)).PKR || 0), liabilityAfterCreate);
    assert.equal(await readCashPosition(), cashAfterCreate, "Approval must not create a second cash deduction");
  } finally {
    await prisma.$transaction(async (tx) => {
      if (createdWithdrawalId) {
        await tx.auditLog.deleteMany({ where: { entityType: "personal_withdrawals", entityId: createdWithdrawalId } });
      }
      if (createdHajiTransferId) {
        await tx.auditLog.deleteMany({ where: { entityType: "haji_transfers", entityId: createdHajiTransferId } });
      }
      if (createdHajiTransferId) {
        await tx.journalEntry.deleteMany({
          where: { transactionId: { in: [`HAJI-${createdHajiTransferId}`, `REV-HAJI-${createdHajiTransferId}`] } },
        });
      }
      if (createdWithdrawalId) {
        await tx.personalWithdrawal.updateMany({
          where: { id: createdWithdrawalId },
          data: { hajiTransferId: null },
        });
      }
      if (createdHajiTransferId) await tx.hajiTransfer.deleteMany({ where: { id: createdHajiTransferId } });
      await tx.personalWithdrawal.deleteMany({ where: { cityId: city.id, detail: marker } });
      await tx.syncRequest.deleteMany({ where: { cityId: city.id, module: "personal_withdrawals.create", requestId: syncRequestId } });
    });
  }
});
