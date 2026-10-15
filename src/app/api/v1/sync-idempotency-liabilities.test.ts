import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as createCityLiability } from "@/app/api/v1/liabilities/route";
import { POST as createCityLiabilityEntry } from "@/app/api/v1/liabilities/[id]/entries/route";
import { POST as createSuperAdminLiability } from "@/app/api/v1/super-admin-liabilities/route";
import { POST as createSuperAdminLiabilityEntry } from "@/app/api/v1/super-admin-liabilities/[id]/entries/route";
import { generateToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

function request(url: string, token: string, requestId: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-sync-request-id": requestId,
      "x-sync-device-id": "liability-offline-test",
    },
    body: JSON.stringify(body),
  });
}

test("city liability account and payment replay create one row and one balanced journal", async () => {
  const marker = `sync-city-liability-${Date.now()}`;
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "PKR currency is required");
  const cityAdmin = await prisma.user.findFirst({
    where: {
      role: "city_admin",
      isActive: true,
      cityId: { not: null },
      city: { cityCurrencies: { some: { currencyId: pkr.id } } },
    },
    include: { city: true },
  });
  assert.ok(cityAdmin?.cityId && cityAdmin.city, "An active city administrator is required");

  const token = generateToken({
    userId: cityAdmin.id,
    username: cityAdmin.username,
    role: "city_admin",
    cityId: cityAdmin.cityId,
    countryId: cityAdmin.city.countryId,
  });
  const accountRequestId = `${marker}-account`;
  const entryRequestId = `${marker}-entry`;
  let accountId: number | null = null;
  let entryId: number | null = null;

  try {
    const accountBody = { name: marker, notes: "offline replay" };
    const [accountA, accountB] = await Promise.all([
      createCityLiability(request("http://localhost/api/v1/liabilities", token, accountRequestId, accountBody), { params: {} }),
      createCityLiability(request("http://localhost/api/v1/liabilities", token, accountRequestId, accountBody), { params: {} }),
    ]);
    const accountJsonA = await accountA.json() as any;
    const accountJsonB = await accountB.json() as any;
    assert.ok([200, 201].includes(accountA.status));
    assert.ok([200, 201].includes(accountB.status));
    assert.equal(accountJsonA.data.id, accountJsonB.data.id);
    accountId = accountJsonA.data.id;
    assert.equal(await prisma.cityLiabilityAccount.count({ where: { cityId: cityAdmin.cityId, name: marker } }), 1);

    const entryBody = {
      entryType: "payment",
      amount: 321,
      currencyId: pkr.id,
      entryDate: "2026-10-01",
      detail: marker,
      paymentSource: "cash_office",
      referenceNo: marker,
    };
    const [entryA, entryB] = await Promise.all([
      createCityLiabilityEntry(request(`http://localhost/api/v1/liabilities/${accountId}/entries`, token, entryRequestId, entryBody), { params: { id: String(accountId) } }),
      createCityLiabilityEntry(request(`http://localhost/api/v1/liabilities/${accountId}/entries`, token, entryRequestId, entryBody), { params: { id: String(accountId) } }),
    ]);
    const entryJsonA = await entryA.json() as any;
    const entryJsonB = await entryB.json() as any;
    assert.ok([200, 201].includes(entryA.status));
    assert.ok([200, 201].includes(entryB.status));
    assert.equal(entryJsonA.data.id, entryJsonB.data.id);
    entryId = entryJsonA.data.id;
    assert.equal(await prisma.cityLiabilityEntry.count({ where: { accountId: accountId || 0, detail: marker } }), 1);
    const journal = await prisma.journalEntry.findMany({ where: { transactionId: `CITYLIAB-${entryId}` } });
    assert.equal(journal.length, 2);
    assert.equal(journal.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0);
  } finally {
    if (entryId) await prisma.journalEntry.deleteMany({ where: { transactionId: `CITYLIAB-${entryId}` } });
    await prisma.syncRequest.deleteMany({ where: { requestId: { startsWith: marker } } });
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ["city_liability_accounts", "city_liability_entries"] }, entityId: { in: [accountId || 0, entryId || 0] } } });
    await prisma.cityLiabilityEntry.deleteMany({ where: { accountId: accountId || 0, detail: marker } });
    await prisma.cityLiabilityAccount.deleteMany({ where: { cityId: cityAdmin.cityId, name: marker } });
  }
});

test("superadmin liability account and charge replay create one row and one balanced journal", async () => {
  const marker = `sync-superadmin-liability-${Date.now()}`;
  const superAdmin = await prisma.user.findFirst({ where: { role: "super_admin", isActive: true } });
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  const counterAccount = await prisma.account.findFirst({ where: { isActive: true, accountType: { in: ["asset", "expense", "cogs"] } } });
  assert.ok(superAdmin && pkr && counterAccount, "Superadmin, PKR, and an active counterpart account are required");
  const token = generateToken({ userId: superAdmin.id, username: superAdmin.username, role: "super_admin", cityId: null, countryId: null });
  const accountRequestId = `${marker}-account`;
  const entryRequestId = `${marker}-entry`;
  let accountId: number | null = null;
  let controlAccountId: number | null = null;
  let entryId: number | null = null;

  try {
    const accountBody = { name: marker, partyType: "creditor", notes: "offline replay" };
    const [accountA, accountB] = await Promise.all([
      createSuperAdminLiability(request("http://localhost/api/v1/super-admin-liabilities", token, accountRequestId, accountBody), { params: {} }),
      createSuperAdminLiability(request("http://localhost/api/v1/super-admin-liabilities", token, accountRequestId, accountBody), { params: {} }),
    ]);
    const accountJsonA = await accountA.json() as any;
    const accountJsonB = await accountB.json() as any;
    assert.ok([200, 201].includes(accountA.status));
    assert.ok([200, 201].includes(accountB.status));
    assert.equal(accountJsonA.data.id, accountJsonB.data.id);
    accountId = accountJsonA.data.id;
    const createdAccount = await prisma.superAdminLiabilityAccount.findUnique({ where: { id: accountId || 0 } });
    assert.ok(createdAccount);
    controlAccountId = createdAccount.controlAccountId;
    assert.equal(await prisma.superAdminLiabilityAccount.count({ where: { name: marker, partyType: "creditor" } }), 1);

    const entryBody = {
      entryType: "liability_incurred",
      entryDate: "2026-10-01",
      amount: 654,
      currencyId: pkr.id,
      counterAccountId: counterAccount.id,
      reference: marker,
      remarks: "offline replay",
    };
    const [entryA, entryB] = await Promise.all([
      createSuperAdminLiabilityEntry(request(`http://localhost/api/v1/super-admin-liabilities/${accountId}/entries`, token, entryRequestId, entryBody), { params: { id: String(accountId) } }),
      createSuperAdminLiabilityEntry(request(`http://localhost/api/v1/super-admin-liabilities/${accountId}/entries`, token, entryRequestId, entryBody), { params: { id: String(accountId) } }),
    ]);
    const entryJsonA = await entryA.json() as any;
    const entryJsonB = await entryB.json() as any;
    assert.ok([200, 201].includes(entryA.status));
    assert.ok([200, 201].includes(entryB.status));
    assert.equal(entryJsonA.data.id, entryJsonB.data.id);
    entryId = entryJsonA.data.id;
    assert.equal(await prisma.superAdminLiabilityEntry.count({ where: { accountId: accountId || 0, reference: marker } }), 1);
    const journal = await prisma.journalEntry.findMany({ where: { transactionId: `SALIAB-${entryId}` } });
    assert.equal(journal.length, 2);
    assert.equal(journal.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0);
  } finally {
    if (entryId) await prisma.journalEntry.deleteMany({ where: { transactionId: `SALIAB-${entryId}` } });
    await prisma.syncRequest.deleteMany({ where: { requestId: { startsWith: marker } } });
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ["super_admin_liability_accounts", "super_admin_liability_entries"] }, entityId: { in: [accountId || 0, entryId || 0] } } });
    await prisma.superAdminLiabilityEntry.deleteMany({ where: { accountId: accountId || 0, reference: marker } });
    await prisma.superAdminLiabilityAccount.deleteMany({ where: { id: accountId || 0 } });
    if (controlAccountId) await prisma.account.deleteMany({ where: { id: controlAccountId } });
  }
});
