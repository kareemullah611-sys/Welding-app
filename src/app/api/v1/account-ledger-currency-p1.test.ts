import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
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

async function mkAccount(tag: string): Promise<number> {
  const account = await prisma.account.create({
    data: { code: `P1${tag}`, name: `P1 ${tag} account`, accountType: "asset", isActive: true },
  });
  return account.id;
}

type Row = { d?: number; c?: number; cur: string; date: string };

async function mkEntries(accountId: number, rows: Row[]): Promise<void> {
  const createdBy = await superadminId();
  await prisma.journalEntry.createMany({
    data: rows.map((r, i) => ({
      transactionId: `P1-${accountId}-${i}`,
      lineNumber: 1,
      accountId,
      debit: r.d ?? 0,
      credit: r.c ?? 0,
      currencyCode: r.cur,
      description: "P1 currency partition test",
      entryDate: new Date(r.date),
      createdBy,
    })),
  });
}

async function cleanup(accountId: number): Promise<void> {
  await prisma.journalEntry.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
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

test("P1 UI: Trial Balance row click always passes the row's own currency to account ledger", () => {
  const src = fs.readFileSync("src/app/(dashboard)/trial-balance/page.tsx", "utf8");
  const start = src.indexOf("const handleRowClick");
  assert.ok(start >= 0, "handleRowClick must exist in trial-balance page");
  const end = src.indexOf("router.push", start);
  assert.ok(end > start, "handleRowClick must push the ledger route");
  const block = src.slice(start, end);
  assert.match(block, /currency:\s*row\.currencyCode|params\.set\("currency",\s*row\.currencyCode\)/, "must set currency from the clicked row");
  assert.doesNotMatch(block, /if\s*\(\s*currency\s*\)/, "must not gate row currency on the page-level currency filter");
});

test("P1: mixed-currency ledger never combines running balances across currencies", async () => {
  const token = await superToken();
  const accountId = await mkAccount("MIX");
  try {
    await mkEntries(accountId, [
      { d: 1000, cur: "PKR", date: "2026-01-01" },
      { c: 50, cur: "USD", date: "2026-01-02" },
      { d: 300, cur: "PKR", date: "2026-01-03" },
      { c: 25, cur: "USD", date: "2026-01-04" },
    ]);
    const { status, body } = await callLedger(`?account_id=${accountId}`, token);
    assert.equal(status, 200);
    assert.equal(body.success, true);
    const balances = body.data.map((r: { balance: number }) => r.balance);
    assert.deepEqual(balances, [1000, -50, 1300, -75], "each row balance must be its own currency's running balance");
    assert.ok(body.meta && body.meta.balances, "meta.balances per-currency map is required");
    assert.equal(body.meta.balances.PKR.closingBalance, 1300);
    assert.equal(body.meta.balances.USD.closingBalance, -75);
    assert.equal(body.meta.openingBalance, null, "legacy single openingBalance must not combine currencies");
    assert.equal(body.meta.closingBalance, null, "legacy single closingBalance must not combine currencies");
  } finally {
    await cleanup(accountId);
  }
});

test("P1: opening balances are reported per currency, never summed across currencies", async () => {
  const token = await superToken();
  const accountId = await mkAccount("OPEN");
  try {
    await mkEntries(accountId, [
      { d: 1000, cur: "PKR", date: "2026-01-01" },
      { c: 50, cur: "USD", date: "2026-01-02" },
      { d: 300, cur: "PKR", date: "2026-01-03" },
      { c: 25, cur: "USD", date: "2026-01-04" },
    ]);
    const { status, body } = await callLedger(
      `?account_id=${accountId}&date_from=2026-01-03&date_to=2026-01-04`,
      token,
    );
    assert.equal(status, 200);
    assert.ok(body.meta && body.meta.balances, "meta.balances per-currency map is required");
    assert.equal(body.meta.balances.PKR.openingBalance, 1000);
    assert.equal(body.meta.balances.USD.openingBalance, -50);
    assert.equal(body.meta.openingBalance, null, "legacy openingBalance must be null for mixed scope");
    const balances = body.data.map((r: { balance: number }) => r.balance);
    assert.deepEqual(balances, [1300, -75], "period balances continue each currency separately");
  } finally {
    await cleanup(accountId);
  }
});

test("P1: single-currency filter keeps the numeric legacy summary fields", async () => {
  const token = await superToken();
  const accountId = await mkAccount("USD");
  try {
    await mkEntries(accountId, [
      { d: 1000, cur: "PKR", date: "2026-01-01" },
      { c: 50, cur: "USD", date: "2026-01-02" },
      { c: 25, cur: "USD", date: "2026-01-04" },
    ]);
    const { status, body } = await callLedger(
      `?account_id=${accountId}&currency=USD&date_from=2026-01-03&date_to=2026-01-04`,
      token,
    );
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.meta.balances), ["USD"]);
    assert.equal(body.meta.openingBalance, -50);
    assert.equal(body.meta.closingBalance, -75);
    assert.equal(body.meta.balances.USD.openingBalance, -50);
    assert.equal(body.meta.balances.USD.closingBalance, -75);
    const balances = body.data.map((r: { balance: number }) => r.balance);
    assert.deepEqual(balances, [-75]);
  } finally {
    await cleanup(accountId);
  }
});

test("P1: legacy RMB rows share the CNY partition (no separate RMB balance bucket)", async () => {
  const token = await superToken();
  const accountId = await mkAccount("RMB");
  try {
    await mkEntries(accountId, [
      { d: 100, cur: "CNY", date: "2026-03-01" },
      { d: 50, cur: "RMB", date: "2026-03-02" },
    ]);
    const { status, body } = await callLedger(`?account_id=${accountId}`, token);
    assert.equal(status, 200);
    const codes = body.data.map((r: { currencyCode: string }) => r.currencyCode);
    assert.deepEqual(codes, ["CNY", "CNY"]);
    const balances = body.data.map((r: { balance: number }) => r.balance);
    assert.deepEqual(balances, [100, 150]);
    assert.ok(body.meta && body.meta.balances, "meta.balances per-currency map is required");
    assert.deepEqual(Object.keys(body.meta.balances), ["CNY"]);
    assert.equal(body.meta.balances.CNY.closingBalance, 150);
  } finally {
    await cleanup(accountId);
  }
});

test("P1: pagination continues each currency's running balance from prior pages", async () => {
  const token = await superToken();
  const accountId = await mkAccount("PAGE");
  try {
    const rows: Row[] = [];
    for (let i = 0; i < 60; i++) {
      rows.push(i % 2 === 0 ? { d: 10, cur: "PKR", date: "2026-04-01" } : { c: 5, cur: "USD", date: "2026-04-01" });
    }
    await mkEntries(accountId, rows);
    const { status, body } = await callLedger(`?account_id=${accountId}&page=2`, token);
    assert.equal(status, 200);
    assert.equal(body.pagination.total, 60);
    assert.equal(body.pagination.totalPages, 2);
    assert.equal(body.data.length, 10);
    assert.equal(body.data[0].currencyCode, "PKR");
    assert.equal(body.data[0].balance, 260, "page 2 must continue PKR running balance (250 + 10)");
    assert.equal(body.data[1].currencyCode, "USD");
    assert.equal(body.data[1].balance, -130, "page 2 must continue USD running balance (-125 - 5)");
    assert.ok(body.meta && body.meta.balances, "meta.balances per-currency map is required");
    assert.equal(body.meta.balances.PKR.closingBalance, 300);
    assert.equal(body.meta.balances.USD.closingBalance, -150);
    assert.equal(body.meta.openingBalance, null);
    assert.equal(body.meta.closingBalance, null);
  } finally {
    await cleanup(accountId);
  }
});
