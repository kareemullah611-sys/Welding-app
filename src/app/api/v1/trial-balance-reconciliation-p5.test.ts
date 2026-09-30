import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getTrialBalance } from "@/app/api/v1/trial-balance/route";
import { GET as exportTrialBalance } from "@/app/api/v1/trial-balance/export/route";

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

async function callApi(path: string, token: string) {
  const res = await getTrialBalance(
    new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: {} },
  );
  return { status: res.status, body: await res.json() };
}

async function callExport(path: string, token: string) {
  const res = await exportTrialBalance(
    new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: {} },
  );
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function xlsxStrings(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  const strings: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (typeof v === "string") strings.push(v);
      else if (v && typeof v === "object" && "text" in v) strings.push(String((v as { text?: unknown }).text));
    });
  });
  return strings;
}

async function cleanupAccounts(ids: number[]): Promise<void> {
  await prisma.journalEntry.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}

const DATE_Q = "date_from=2026-08-01&date_to=2026-08-31";

test("P5: shared predicate — search and account_type filters make reconciliation not meaningful", async () => {
  const { reconciliationIsMeaningful } = await import("@/lib/trial-balance");
  assert.equal(reconciliationIsMeaningful({}), true);
  assert.equal(reconciliationIsMeaningful({ search: null, accountType: null }), true);
  assert.equal(reconciliationIsMeaningful({ search: "cash" }), false);
  assert.equal(reconciliationIsMeaningful({ accountType: "asset" }), false);
  assert.equal(reconciliationIsMeaningful({ search: "cash", accountType: "asset" }), false);
});

test("P5: unfiltered balanced data keeps its Yes/NO reconciliation block in XLSX and meaningful=true in API", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P5U${Date.now()}`;
  const debitAcc = await prisma.account.create({
    data: { code: `${marker}D`.slice(0, 20), name: `${marker} debit`, accountType: "asset", isActive: true },
  });
  const creditAcc = await prisma.account.create({
    data: { code: `${marker}C`.slice(0, 20), name: `${marker} credit`, accountType: "liability", isActive: true },
  });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `${marker}-D`, lineNumber: 1, accountId: debitAcc.id, debit: 900, credit: 0, currencyCode: "PKR", description: "P5 seed", entryDate: new Date("2026-08-10"), createdBy },
        { transactionId: `${marker}-C`, lineNumber: 1, accountId: creditAcc.id, debit: 0, credit: 900, currencyCode: "PKR", description: "P5 seed", entryDate: new Date("2026-08-10"), createdBy },
      ],
    });

    const api = await callApi(`/api/v1/trial-balance?${DATE_Q}`, token);
    assert.equal(api.status, 200);
    assert.equal(api.body.data.reconciliationMeaningful, true, "unfiltered scope must be meaningful");
    const pkr = api.body.data.reconciliation.find((r: { currency: string }) => r.currency === "PKR");
    assert.equal(pkr.balanced, true, "balanced fixture must reconcile when unfiltered");

    const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}`, token);
    assert.equal(xlsx.status, 200);
    const strings = await xlsxStrings(xlsx.buffer);
    assert.ok(strings.includes("Yes"), "unfiltered export must still print Yes/NO results");
    assert.ok(!strings.some((s) => s.includes("not applicable (filtered view)")), "unfiltered export must not print the filtered label");
  } finally {
    await cleanupAccounts([debitAcc.id, creditAcc.id]);
  }
});

test("P5: filtered subsets print 'not applicable (filtered view)' instead of Balanced: NO", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P5F${Date.now()}`;
  const debitAcc = await prisma.account.create({
    data: { code: `${marker}D`.slice(0, 20), name: `${marker} debitonly`, accountType: "asset", isActive: true },
  });
  const creditAcc = await prisma.account.create({
    data: { code: `${marker}C`.slice(0, 20), name: `${marker} creditonly`, accountType: "liability", isActive: true },
  });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `${marker}-D`, lineNumber: 1, accountId: debitAcc.id, debit: 500, credit: 0, currencyCode: "PKR", description: "P5 seed", entryDate: new Date("2026-08-11"), createdBy },
        { transactionId: `${marker}-C`, lineNumber: 1, accountId: creditAcc.id, debit: 0, credit: 500, currencyCode: "PKR", description: "P5 seed", entryDate: new Date("2026-08-11"), createdBy },
      ],
    });

    for (const filter of [`q=${marker}D`, `account_type=asset&q=${marker}`]) {
      const api = await callApi(`/api/v1/trial-balance?${DATE_Q}&${filter}`, token);
      assert.equal(api.status, 200, `API must accept ${filter}`);
      assert.equal(
        api.body.data.reconciliationMeaningful,
        false,
        `${filter}: API must mark reconciliation as not meaningful`,
      );

      const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}&${filter}`, token);
      assert.equal(xlsx.status, 200, `export must accept ${filter}`);
      const strings = await xlsxStrings(xlsx.buffer);
      assert.ok(
        strings.some((s) => s.includes("not applicable (filtered view)")),
        `${filter}: XLSX must label reconciliation as not applicable (filtered view)`,
      );
      assert.ok(
        !strings.some((s) => s === "NO"),
        `${filter}: XLSX must not print Balanced: NO for an expected subset imbalance`,
      );
    }
  } finally {
    await cleanupAccounts([debitAcc.id, creditAcc.id]);
  }
});
