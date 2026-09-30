import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getTrialBalance } from "@/app/api/v1/trial-balance/route";
import { GET as getFinancialReports } from "@/app/api/v1/financial-reports/route";

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

async function callApi(handler: typeof getTrialBalance, path: string, token: string) {
  const res = await handler(
    new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: {} },
  );
  return { status: res.status, body: await res.json() };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function normalizeCurrency(code: string): string {
  return code === "RMB" ? "CNY" : code;
}

type Fixture = {
  codes: { asset: string; liability: string; revenue: string; expense: string };
  accountIds: number[];
  transactionIds: string[];
  cleanup: () => Promise<void>;
};

async function seedFixture(): Promise<Fixture> {
  const createdBy = await superadminId();
  const marker = `P8${Date.now()}`.slice(0, 14);
  const codes = {
    asset: `${marker}A`.slice(0, 20),
    liability: `${marker}L`.slice(0, 20),
    revenue: `${marker}R`.slice(0, 20),
    expense: `${marker}E`.slice(0, 20),
  };
  const [assetAcc, liabAcc, revAcc, expAcc] = await Promise.all([
    prisma.account.create({ data: { code: codes.asset, name: "P8 asset", accountType: "asset", isActive: true } }),
    prisma.account.create({ data: { code: codes.liability, name: "P8 liability", accountType: "liability", isActive: true } }),
    prisma.account.create({ data: { code: codes.revenue, name: "P8 revenue", accountType: "revenue", isActive: true } }),
    prisma.account.create({ data: { code: codes.expense, name: "P8 expense", accountType: "expense", isActive: true } }),
  ]);
  const entryDate = new Date("2026-03-05");
  const transactionIds = ["P8-PKR-1", "P8-PKR-2", "P8-USD-1", "P8-RMB-1", "P8-CNY-1"];
  await prisma.journalEntry.createMany({
    data: [
      { transactionId: "P8-PKR-1", lineNumber: 1, accountId: assetAcc.id, debit: 1000, credit: 0, currencyCode: "PKR", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-PKR-1", lineNumber: 2, accountId: revAcc.id, debit: 0, credit: 1000, currencyCode: "PKR", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-PKR-2", lineNumber: 1, accountId: expAcc.id, debit: 400, credit: 0, currencyCode: "PKR", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-PKR-2", lineNumber: 2, accountId: assetAcc.id, debit: 0, credit: 400, currencyCode: "PKR", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-USD-1", lineNumber: 1, accountId: assetAcc.id, debit: 250, credit: 0, currencyCode: "USD", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-USD-1", lineNumber: 2, accountId: revAcc.id, debit: 0, credit: 250, currencyCode: "USD", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-RMB-1", lineNumber: 1, accountId: expAcc.id, debit: 60, credit: 0, currencyCode: "RMB", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-RMB-1", lineNumber: 2, accountId: assetAcc.id, debit: 0, credit: 60, currencyCode: "RMB", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-CNY-1", lineNumber: 1, accountId: assetAcc.id, debit: 30, credit: 0, currencyCode: "CNY", description: "P8 seed", entryDate, createdBy },
      { transactionId: "P8-CNY-1", lineNumber: 2, accountId: revAcc.id, debit: 0, credit: 30, currencyCode: "CNY", description: "P8 seed", entryDate, createdBy },
    ],
  });
  return {
    codes,
    accountIds: [assetAcc.id, liabAcc.id, revAcc.id, expAcc.id],
    transactionIds,
    cleanup: async () => {
      await prisma.journalEntry.deleteMany({ where: { accountId: { in: [assetAcc.id, liabAcc.id, revAcc.id, expAcc.id] } } });
      await prisma.account.deleteMany({ where: { id: { in: [assetAcc.id, liabAcc.id, revAcc.id, expAcc.id] } } });
    },
  };
}

const TB_RANGE = "date_from=2026-01-01&date_to=2026-12-31";

test("P8: every TB currency total equals the same-currency journal source sums (RMB grouped into CNY)", async () => {
  const token = await superToken();
  const fx = await seedFixture();
  try {
    const api = await callApi(getTrialBalance, `/api/v1/trial-balance?${TB_RANGE}`, token);
    assert.equal(api.status, 200);

    // Independent oracle from journal source. App semantics (pre-existing):
    // period Dr/Cr = gross journal sums; opening/closing = net split per (account, currency).
    const inRange = await prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where: { entryDate: { gte: new Date("2026-01-01"), lt: new Date("2027-01-01") } },
      _sum: { debit: true, credit: true },
    });
    const beforeRange = await prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where: { entryDate: { lt: new Date("2026-01-01") } },
      _sum: { debit: true, credit: true },
    });
    type Totals = { periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number };
    const expected: Record<string, Totals> = {};
    const bucket = (currencyCode: string): Totals => {
      const curr = normalizeCurrency(String(currencyCode));
      expected[curr] = expected[curr] || { periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
      return expected[curr];
    };
    const sumByKey = (rows: typeof inRange): Map<string, { dr: number; cr: number }> => {
      const map = new Map<string, { dr: number; cr: number }>();
      for (const g of rows) {
        const key = `${g.accountId}:${normalizeCurrency(String(g.currencyCode))}`;
        const entry = map.get(key) || { dr: 0, cr: 0 };
        entry.dr += Number(g._sum.debit || 0);
        entry.cr += Number(g._sum.credit || 0);
        map.set(key, entry);
      }
      return map;
    };
    for (const g of inRange) {
      const t = bucket(g.currencyCode);
      t.periodDebit += Number(g._sum.debit || 0);
      t.periodCredit += Number(g._sum.credit || 0);
    }
    const inRangeByKey = sumByKey(inRange);
    const beforeByKey = sumByKey(beforeRange);
    const allKeys = new Set([...inRangeByKey.keys(), ...beforeByKey.keys()]);
    for (const key of allKeys) {
      const currencyCode = key.split(":")[1];
      const before = beforeByKey.get(key) || { dr: 0, cr: 0 };
      const inside = inRangeByKey.get(key) || { dr: 0, cr: 0 };
      const openingNet = before.dr - before.cr;
      const closingNet = openingNet + inside.dr - inside.cr;
      const t = bucket(currencyCode);
      t.closingDebit += closingNet > 0 ? closingNet : 0;
      t.closingCredit += closingNet < 0 ? Math.abs(closingNet) : 0;
    }

    const totals = api.body.data.currencyTotals as Record<string, Totals>;
    assert.deepEqual(Object.keys(totals).sort(), Object.keys(expected).sort(), "TB currency keys must equal journal currencies (normalized)");
    assert.ok(!("RMB" in totals), "RMB must be normalized into CNY, never its own TB currency");
    for (const [curr, exp] of Object.entries(expected)) {
      assert.equal(r2(totals[curr].periodDebit), r2(exp.periodDebit), `${curr} period debit must equal gross journal source sum`);
      assert.equal(r2(totals[curr].periodCredit), r2(exp.periodCredit), `${curr} period credit must equal gross journal source sum`);
      assert.equal(r2(totals[curr].closingDebit), r2(exp.closingDebit), `${curr} closing debit must equal net-split source balance`);
      assert.equal(r2(totals[curr].closingCredit), r2(exp.closingCredit), `${curr} closing credit must equal net-split source balance`);
    }
    assert.equal(api.body.data.reconciliationMeaningful, true, "unfiltered full-scope TB must be meaningful");
    assert.equal(api.body.data.allBalanced, true, "balanced fixture must reconcile");
  } finally {
    await fx.cleanup();
  }
});

test("P8: TB PKR per-account nets equal balance_sheet PKR rows; foreign rows stay in raw units", async () => {
  const token = await superToken();
  const fx = await seedFixture();
  try {
    const [api, bs] = await Promise.all([
      callApi(getTrialBalance, `/api/v1/trial-balance?${TB_RANGE}`, token),
      callApi(getFinancialReports as typeof getTrialBalance, "/api/v1/financial-reports?report=balance_sheet", token),
    ]);
    assert.equal(api.status, 200);
    assert.equal(bs.status, 200);

    const tbNetByCode = new Map<string, number>();
    for (const section of api.body.data.sections) {
      for (const group of section.groups) {
        for (const row of group.rows) {
          if (row.currencyCode !== "PKR") continue;
          const net = ["asset", "expense", "cogs"].includes(row.accountType)
            ? row.closingDebit - row.closingCredit
            : row.closingCredit - row.closingDebit;
          tbNetByCode.set(row.accountCode, r2(net));
        }
      }
    }

    const bsRows = [...bs.body.data.assets, ...bs.body.data.liabilities, ...bs.body.data.equity, ...bs.body.data.revenue, ...bs.body.data.expenses];
    const bsPkrByCode = new Map<string, number>();
    const bsForeign = new Map<string, { currency: string; balance: number }>();
    for (const row of bsRows) {
      if (row.currency === "PKR") bsPkrByCode.set(row.code, row.balance);
      else bsForeign.set(`${row.code}|${row.currency}`, { currency: row.currency, balance: row.balance });
    }

    const expectedPkr: Record<string, number> = {
      [fx.codes.asset]: 600,
      [fx.codes.revenue]: 1000,
      [fx.codes.expense]: 400,
    };
    for (const [code, expected] of Object.entries(expectedPkr)) {
      assert.equal(tbNetByCode.get(code), expected, `TB PKR net for ${code}`);
      assert.equal(bsPkrByCode.get(code), expected, `balance_sheet PKR row for ${code} must equal TB PKR net`);
    }

    assert.equal(bsForeign.get(`${fx.codes.asset}|USD`)?.balance, 250, "USD balance_sheet row must stay in raw USD units");
    assert.equal(bsForeign.get(`${fx.codes.asset}|CNY`)?.balance, 30, "CNY balance_sheet row must stay in raw CNY units");
    assert.equal(bsForeign.get(`${fx.codes.asset}|RMB`)?.balance, -60, "RMB balance_sheet row must stay in raw RMB units");
  } finally {
    await fx.cleanup();
  }
});

test("P8: authoritative PKR P&L equals TB PKR P&L recognition; foreign journals warn instead of converting", async () => {
  const token = await superToken();
  const fx = await seedFixture();
  try {
    const [api, pnl] = await Promise.all([
      callApi(getTrialBalance, `/api/v1/trial-balance?${TB_RANGE}`, token),
      callApi(getFinancialReports as typeof getTrialBalance, "/api/v1/financial-reports?report=pnl&year=2026", token),
    ]);
    assert.equal(api.status, 200);
    assert.equal(pnl.status, 200);

    let tbPkrRevenue = 0;
    let tbPkrExpense = 0;
    for (const section of api.body.data.sections) {
      for (const group of section.groups) {
        for (const row of group.rows) {
          if (row.currencyCode !== "PKR") continue;
          if (row.accountType === "revenue") tbPkrRevenue += row.periodCredit - row.periodDebit;
          if (row.accountType === "expense") tbPkrExpense += row.periodDebit - row.periodCredit;
        }
      }
    }

    const authoritative = pnl.body.data.authoritativePkr;
    assert.equal(r2(tbPkrRevenue), 1000, "TB PKR revenue must be the PKR journals only");
    assert.equal(r2(tbPkrExpense), 400, "TB PKR expense must be the PKR journals only");
    assert.equal(authoritative.totalRevenue, r2(tbPkrRevenue), "authoritative PKR revenue must equal TB PKR revenue recognition (no raw-USD conversion)");
    assert.equal(authoritative.totalExpenses, r2(tbPkrExpense), "authoritative PKR expense must equal TB PKR expense recognition");

    const byCurrency = pnl.body.data.pnl as Array<{ currency: string; revenue: number; expenseTotal: number }>;
    const usdRow = byCurrency.find((row) => row.currency === "USD");
    assert.equal(usdRow?.revenue, 250, "USD P&L row must keep raw USD revenue");
    const rmbRow = byCurrency.find((row) => row.currency === "RMB");
    const cnyRow = byCurrency.find((row) => row.currency === "CNY");
    assert.equal(cnyRow?.revenue, 30, "CNY P&L row must keep raw CNY revenue");
    assert.equal(rmbRow?.expenseTotal, 60, "RMB P&L row must keep raw RMB expense");

    const warnings = pnl.body.data.fxWarnings as string[];
    assert.ok(
      warnings.some((w) => w.startsWith("USD revenue journal entries require stored PKR recognition")),
      "unsupported foreign revenue must be surfaced as a warning, never forced into PKR",
    );
    assert.ok(
      warnings.some((w) => w.startsWith("RMB expense journal entries require stored PKR recognition")),
      "unsupported RMB expense must be surfaced as a warning, never forced into PKR",
    );
  } finally {
    await fx.cleanup();
  }
});
