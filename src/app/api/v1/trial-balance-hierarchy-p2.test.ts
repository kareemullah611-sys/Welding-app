import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getTrialBalance } from "@/app/api/v1/trial-balance/route";
import { GET as getLedger } from "@/app/api/v1/account-ledger/route";

async function superToken(): Promise<string> {
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  return generateToken({
    userId: superadmin.id,
    username: superadmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
}

async function superadminId(): Promise<number> {
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  return superadmin.id;
}

async function callTrialBalance(query: string, token: string) {
  const res = await getTrialBalance(
    new NextRequest(`http://localhost/api/v1/trial-balance${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: {} },
  );
  return { status: res.status, body: await res.json() };
}

async function callLedger(query: string, token: string) {
  const res = await getLedger(
    new NextRequest(`http://localhost/api/v1/account-ledger${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: {} },
  );
  return { status: res.status, body: await res.json() };
}

function findRowIn(body: unknown, code: string) {
  const data = body as { sections?: Array<{ groups?: Array<{ rows?: Array<Record<string, unknown>> }> }> };
  for (const section of data.sections || []) {
    for (const group of section.groups || []) {
      for (const row of group.rows || []) {
        if (row.accountCode === code) return row;
      }
    }
  }
  return undefined;
}

const DATE_Q = "date_from=2026-06-01&date_to=2026-06-30";

async function cleanupAccounts(ids: number[]): Promise<void> {
  await prisma.journalEntry.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.updateMany({ where: { id: { in: ids } }, data: { parentId: null } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}

test("P2 API: parent rows show recursive totals, hierarchy fields, and direct-based totals", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P2H${Date.now()}`;
  const parent = await prisma.account.create({
    data: { code: `${marker}PAR`.slice(0, 20), name: `${marker} parent`, accountType: "asset", isActive: true },
  });
  const child = await prisma.account.create({
    data: { code: `${marker}CHD`.slice(0, 20), name: `${marker} child`, accountType: "asset", isActive: true, parentId: parent.id },
  });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `${marker}-P`, lineNumber: 1, accountId: parent.id, debit: 1000, credit: 0, currencyCode: "PKR", description: "P2 hierarchy seed", entryDate: new Date("2026-06-10"), createdBy },
        { transactionId: `${marker}-C`, lineNumber: 1, accountId: child.id, debit: 500, credit: 0, currencyCode: "PKR", description: "P2 hierarchy seed", entryDate: new Date("2026-06-11"), createdBy },
      ],
    });

    const { status, body } = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(status, 200);
    const parentRow = findRowIn(body.data, parent.code);
    const childRow = findRowIn(body.data, child.code);
    assert.ok(parentRow, "parent row must be returned");
    assert.ok(childRow, "child row must be returned");
    assert.equal(parentRow.closingDebit, 1500, "parent displays recursive total");
    assert.equal(parentRow.periodDebit, 1500);
    assert.equal(childRow.closingDebit, 500);
    assert.equal(parentRow.depth, 0);
    assert.equal(childRow.depth, 1);
    assert.equal(childRow.parentId, parent.id);
    assert.equal(parentRow.isParentRow, true);
    assert.equal(parentRow.hasDirectEntries, true);
    const totals = body.data.currencyTotals.PKR;
    assert.equal(totals.closingDebit, 1500, "totals count each journal exactly once");

    const filtered = await callTrialBalance(`?${DATE_Q}&account_type=asset`, token);
    assert.equal(filtered.status, 200);
    assert.ok(findRowIn(filtered.body.data, parent.code), "same-type parent must survive account_type filter");
    assert.ok(findRowIn(filtered.body.data, child.code), "child must survive account_type filter");
  } finally {
    await cleanupAccounts([child.id, parent.id]);
  }
});

test("P2 API: cycle in account hierarchy is rejected with a structured error", async () => {
  const token = await superToken();
  const marker = `P2Y${Date.now()}`;
  const a = await prisma.account.create({
    data: { code: `${marker}A`.slice(0, 20), name: `${marker} a`, accountType: "asset", isActive: true },
  });
  const b = await prisma.account.create({
    data: { code: `${marker}B`.slice(0, 20), name: `${marker} b`, accountType: "asset", isActive: true, parentId: a.id },
  });
  try {
    await prisma.account.update({ where: { id: a.id }, data: { parentId: b.id } });
    const { status, body } = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(status, 400, "cycle must be rejected, not silently reported");
    assert.equal(body.error?.code, "ACCOUNT_HIERARCHY_INVALID");
    assert.match(body.error?.message || "", /cycle/i);
  } finally {
    await cleanupAccounts([b.id, a.id]);
  }
});

test("P2 API: cross-account-type parenting is rejected", async () => {
  const token = await superToken();
  const marker = `P2T${Date.now()}`;
  const parent = await prisma.account.create({
    data: { code: `${marker}P`.slice(0, 20), name: `${marker} parent`, accountType: "liability", isActive: true },
  });
  const child = await prisma.account.create({
    data: { code: `${marker}C`.slice(0, 20), name: `${marker} child`, accountType: "asset", isActive: true, parentId: parent.id },
  });
  try {
    const { status, body } = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(status, 400, "parent/child accountType mismatch must be rejected");
    assert.equal(body.error?.code, "ACCOUNT_HIERARCHY_INVALID");
    assert.match(body.error?.message || "", /accountType mismatch/i);
  } finally {
    await cleanupAccounts([child.id, parent.id]);
  }
});

test("P2 API: self-parenting is rejected", async () => {
  const token = await superToken();
  const marker = `P2S${Date.now()}`;
  const a = await prisma.account.create({
    data: { code: `${marker}A`.slice(0, 20), name: `${marker} self`, accountType: "asset", isActive: true },
  });
  try {
    await prisma.account.update({ where: { id: a.id }, data: { parentId: a.id } });
    const { status, body } = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(status, 400, "self-parenting must be rejected");
    assert.equal(body.error?.code, "ACCOUNT_HIERARCHY_INVALID");
    assert.match(body.error?.message || "", /own parent/i);
  } finally {
    await cleanupAccounts([a.id]);
  }
});

test("P2 ledger: parent account reports descendant count and direct-entries-only scope", async () => {
  const token = await superToken();
  const marker = `P2L${Date.now()}`;
  const parent = await prisma.account.create({
    data: { code: `${marker}PAR`.slice(0, 20), name: `${marker} parent`, accountType: "asset", isActive: true },
  });
  const child = await prisma.account.create({
    data: { code: `${marker}CHD`.slice(0, 20), name: `${marker} child`, accountType: "asset", isActive: true, parentId: parent.id },
  });
  try {
    const parentLedger = await callLedger(`?account_id=${parent.id}`, token);
    assert.equal(parentLedger.status, 200);
    assert.equal(parentLedger.body.meta?.descendantCount, 1, "parent ledger must report its descendant count");
    assert.equal(parentLedger.body.meta?.directEntriesOnly, true, "parent ledger must be labeled direct-entries-only");

    const childLedger = await callLedger(`?account_id=${child.id}`, token);
    assert.equal(childLedger.status, 200);
    assert.equal(childLedger.body.meta?.descendantCount, 0, "leaf accounts have no descendants");
    assert.equal(childLedger.body.meta?.directEntriesOnly, false);
  } finally {
    await cleanupAccounts([child.id, parent.id]);
  }
});

test("P2 API: dormant cycle (inactive, no journals) stays out of TB scope but fails closed once journaled", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P2D${Date.now()}`;
  const a = await prisma.account.create({
    data: { code: `${marker}A`.slice(0, 20), name: `${marker} dormant a`, accountType: "asset", isActive: false },
  });
  const b = await prisma.account.create({
    data: { code: `${marker}B`.slice(0, 20), name: `${marker} dormant b`, accountType: "asset", isActive: false, parentId: a.id },
  });
  try {
    await prisma.account.update({ where: { id: a.id }, data: { parentId: b.id } });

    const dormant = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(dormant.status, 200, "cycle outside the reporting scope must not block the whole TB");
    assert.ok(!findRowIn(dormant.body.data, a.code), "dormant account must not appear in rows");
    assert.ok(!findRowIn(dormant.body.data, b.code), "dormant account must not appear in rows");

    await prisma.journalEntry.create({
      data: { transactionId: `${marker}-J`, lineNumber: 1, accountId: a.id, debit: 100, credit: 0, currencyCode: "PKR", description: "P2 dormant cycle fails closed", entryDate: new Date("2026-06-10"), createdBy },
    });
    const journaled = await callTrialBalance(`?${DATE_Q}`, token);
    assert.equal(journaled.status, 400, "a journaled account inside a cycle must fail closed");
    assert.equal(journaled.body.error?.code, "ACCOUNT_HIERARCHY_INVALID");
    assert.match(journaled.body.error?.message || "", /cycle/i);
  } finally {
    await cleanupAccounts([b.id, a.id]);
  }
});
