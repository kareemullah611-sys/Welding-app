import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as createTransfer } from "@/app/api/v1/super-admin-account-transfers/route";
import { POST as reverseTransfer } from "@/app/api/v1/super-admin-account-transfers/[id]/reverse/route";
import { generateToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

test("superadmin account transfer retry and concurrent replay create one transfer and one journal", async () => {
  const marker = `sync-superadmin-transfer-${Date.now()}`;
  const [superAdmin, pkr, usd] = await Promise.all([
    prisma.user.findUnique({ where: { username: "superadmin" } }),
    prisma.currency.findUnique({ where: { code: "PKR" } }),
    prisma.currency.findUnique({ where: { code: "USD" } }),
  ]);
  assert.ok(superAdmin && pkr && usd, "Seeded superadmin, PKR, and USD currencies are required");

  const [source, destination, fxDestination] = await Promise.all([
    prisma.superAdminBankAccount.create({ data: { bankName: `${marker}-source`, currencyId: pkr.id, createdBy: superAdmin.id } }),
    prisma.superAdminBankAccount.create({ data: { bankName: `${marker}-destination`, currencyId: pkr.id, createdBy: superAdmin.id } }),
    prisma.superAdminBankAccount.create({ data: { bankName: `${marker}-fx-destination`, currencyId: usd.id, createdBy: superAdmin.id } }),
  ]);
  const token = generateToken({ userId: superAdmin.id, username: superAdmin.username, role: "super_admin", cityId: null, countryId: null });
  const createdIds: number[] = [];

  const request = (requestId: string, reference: string, overrides: Record<string, unknown> = {}) => new NextRequest("http://localhost/api/v1/super-admin-account-transfers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-sync-request-id": requestId,
      "x-sync-device-id": "browser-test",
    },
    body: JSON.stringify({
      transferDate: "2026-09-16",
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      fromAmount: 1250,
      toAmount: 1250,
      reference,
      ...overrides,
    }),
  });

  try {
    const retryKey = `${marker}-retry`;
    const first = await createTransfer(request(retryKey, `${marker}-sequential`), { params: {} });
    const second = await createTransfer(request(retryKey, `${marker}-sequential`), { params: {} });
    const firstJson = await first.json() as any;
    const secondJson = await second.json() as any;
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(firstJson.data.id, secondJson.data.id);
    createdIds.push(firstJson.data.id);

    const concurrentKey = `${marker}-concurrent`;
    const [concurrentA, concurrentB] = await Promise.all([
      createTransfer(request(concurrentKey, `${marker}-concurrent`), { params: {} }),
      createTransfer(request(concurrentKey, `${marker}-concurrent`), { params: {} }),
    ]);
    const concurrentJsonA = await concurrentA.json() as any;
    const concurrentJsonB = await concurrentB.json() as any;
    assert.ok([200, 201].includes(concurrentA.status));
    assert.ok([200, 201].includes(concurrentB.status));
    assert.equal(concurrentJsonA.data.id, concurrentJsonB.data.id);
    createdIds.push(concurrentJsonA.data.id);

    const exchangeKey = `${marker}-exchange`;
    const exchangeBody = {
      destinationAccountId: fxDestination.id,
      fromAmount: 1000,
      toAmount: 3.5,
      exchangeRate: 0.0035,
      rateSource: "Test documented rate",
    };
    const exchangeFirst = await createTransfer(request(exchangeKey, `${marker}-exchange`, exchangeBody), { params: {} });
    const exchangeRetry = await createTransfer(request(exchangeKey, `${marker}-exchange`, exchangeBody), { params: {} });
    const exchangeFirstJson = await exchangeFirst.json() as any;
    const exchangeRetryJson = await exchangeRetry.json() as any;
    assert.equal(exchangeFirst.status, 201);
    assert.equal(exchangeRetry.status, 200);
    assert.equal(exchangeFirstJson.data.id, exchangeRetryJson.data.id);
    createdIds.push(exchangeFirstJson.data.id);

    const rows = await prisma.superAdminAccountTransfer.findMany({ where: { id: { in: createdIds } } });
    assert.equal(rows.length, 3);
    for (const id of createdIds.slice(0, 2)) {
      const journal = await prisma.journalEntry.findMany({
        where: { entityType: "super_admin_account_transfer", entityId: id },
      });
      assert.equal(journal.length, 2);
      assert.equal(journal.reduce((sum, line) => sum + Number(line.debit), 0), 1250);
      assert.equal(journal.reduce((sum, line) => sum + Number(line.credit), 0), 1250);
    }
    assert.equal(await prisma.journalEntry.count({ where: { entityType: "super_admin_account_transfer", entityId: exchangeFirstJson.data.id } }), 4);

    const [sourceLedger, destinationLedger] = await Promise.all([
      prisma.superAdminAccountTransfer.findMany({ where: { reversedAt: null, sourceAccountId: source.id } }),
      prisma.superAdminAccountTransfer.findMany({ where: { reversedAt: null, destinationAccountId: destination.id } }),
    ]);
    const fxDestinationLedger = await prisma.superAdminAccountTransfer.findMany({ where: { reversedAt: null, destinationAccountId: fxDestination.id } });
    assert.equal(sourceLedger.length, 3);
    assert.equal(destinationLedger.length, 2);
    assert.equal(fxDestinationLedger.length, 1);
    assert.equal(sourceLedger.reduce((sum, row) => sum + Number(row.fromAmount), 0), 3500);
    assert.equal(destinationLedger.reduce((sum, row) => sum + Number(row.toAmount), 0), 2500);
    assert.equal(fxDestinationLedger.reduce((sum, row) => sum + Number(row.toAmount), 0), 3.5);

    const reversal = await reverseTransfer(new NextRequest(`http://localhost/api/v1/super-admin-account-transfers/${firstJson.data.id}/reverse`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Idempotency regression verification" }),
    }), { params: { id: String(firstJson.data.id) } });
    assert.equal(reversal.status, 200);
    const retryAfterReversal = await createTransfer(request(retryKey, `${marker}-sequential`), { params: {} });
    assert.equal(retryAfterReversal.status, 200);
    assert.equal((await retryAfterReversal.json() as any).data.id, firstJson.data.id);
    assert.equal(await prisma.superAdminAccountTransfer.count({ where: { reference: { startsWith: marker } } }), 3);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-SATRANS-${firstJson.data.id}` } }), 2);
  } finally {
    const testTransfers = await prisma.superAdminAccountTransfer.findMany({
      where: { reference: { startsWith: marker } },
      select: { id: true },
    });
    const cleanupIds = testTransfers.map((row) => row.id);
    await prisma.journalEntry.deleteMany({ where: { entityType: "super_admin_account_transfer", entityId: { in: cleanupIds } } });
    await prisma.syncRequest.deleteMany({ where: { module: "super_admin_account_transfers", requestId: { startsWith: marker } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "super_admin_account_transfers", entityId: { in: cleanupIds } } });
    await prisma.superAdminAccountTransfer.deleteMany({ where: { id: { in: cleanupIds } } });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: { in: [source.id, destination.id, fxDestination.id] } } });
    await prisma.account.deleteMany({ where: { code: { in: [`1050-SABANK${source.id}`, `1050-SABANK${destination.id}`, `1050-SABANK${fxDestination.id}`] } } });
  }
});
