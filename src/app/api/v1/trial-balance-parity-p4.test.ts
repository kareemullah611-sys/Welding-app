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
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "" };
}

type XlsxRow = {
  code: string;
  name: string;
  currency: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

const CURRENCY_CODES = ["PKR", "USD", "AFN", "CNY", "AED", "RMB"];

async function readXlsxRows(buffer: Buffer): Promise<XlsxRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  const rows: XlsxRow[] = [];
  sheet.eachRow((values) => {
    const v = values.values as unknown[];
    const code = typeof v[1] === "string" ? v[1] : "";
    const currency = typeof v[3] === "string" ? v[3] : "";
    if (!code || !CURRENCY_CODES.includes(currency)) return;
    const num = (x: unknown) => Number(x || 0);
    rows.push({
      code,
      name: typeof v[2] === "string" ? v[2] : "",
      currency,
      openingDebit: num(v[4]),
      openingCredit: num(v[5]),
      periodDebit: num(v[6]),
      periodCredit: num(v[7]),
      closingDebit: num(v[8]),
      closingCredit: num(v[9]),
    });
  });
  return rows;
}

function apiRows(body: {
  sections?: Array<{ groups?: Array<{ rows?: Array<Record<string, unknown>> }> }>;
}): XlsxRow[] {
  const rows: XlsxRow[] = [];
  for (const section of body.sections || []) {
    for (const group of section.groups || []) {
      for (const row of group.rows || []) {
        rows.push({
          code: String(row.accountCode),
          name: String(row.accountName),
          currency: String(row.currencyCode),
          openingDebit: Number(row.openingDebit || 0),
          openingCredit: Number(row.openingCredit || 0),
          periodDebit: Number(row.periodDebit || 0),
          periodCredit: Number(row.periodCredit || 0),
          closingDebit: Number(row.closingDebit || 0),
          closingCredit: Number(row.closingCredit || 0),
        });
      }
    }
  }
  return rows;
}

function assertRowsParity(api: XlsxRow[], xlsx: XlsxRow[], label: string) {
  const key = (r: XlsxRow) => `${r.code}|${r.currency}`;
  const apiByKey = new Map(api.map((r) => [key(r), r]));
  const xlsxByKey = new Map(xlsx.map((r) => [key(r), r]));
  assert.deepEqual(
    [...xlsxByKey.keys()].sort(),
    [...apiByKey.keys()].sort(),
    `${label}: XLSX must contain exactly the same account rows as the API`,
  );
  for (const [k, apiRow] of apiByKey) {
    const xlsxRow = xlsxByKey.get(k);
    assert.ok(xlsxRow, `${label}: missing XLSX row for ${k}`);
    for (const field of ["openingDebit", "openingCredit", "periodDebit", "periodCredit", "closingDebit", "closingCredit"] as const) {
      assert.equal(xlsxRow[field], apiRow[field], `${label}: ${k} ${field} mismatch (API ${apiRow[field]} vs XLSX ${xlsxRow[field]})`);
    }
  }
}

async function cleanupAccounts(ids: number[]): Promise<void> {
  await prisma.journalEntry.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.updateMany({ where: { id: { in: ids } }, data: { parentId: null } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}

const DATE_Q = "date_from=2026-07-01&date_to=2026-07-31";

test("P4 parity: inactive multi-level ancestors load identically in API and XLSX", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P4A${Date.now()}`;
  const grandparent = await prisma.account.create({
    data: { code: `${marker}GP`.slice(0, 20), name: `${marker} grandparent`, accountType: "asset", isActive: false },
  });
  const parent = await prisma.account.create({
    data: { code: `${marker}PA`.slice(0, 20), name: `${marker} parent`, accountType: "asset", isActive: false, parentId: grandparent.id },
  });
  const child = await prisma.account.create({
    data: { code: `${marker}CH`.slice(0, 20), name: `${marker} child`, accountType: "asset", isActive: true, parentId: parent.id },
  });
  try {
    await prisma.journalEntry.create({
      data: { transactionId: `${marker}-C`, lineNumber: 1, accountId: child.id, debit: 700, credit: 0, currencyCode: "PKR", description: "P4 parity seed", entryDate: new Date("2026-07-10"), createdBy },
    });

    const api = await callApi(`/api/v1/trial-balance?${DATE_Q}`, token);
    assert.equal(api.status, 200);
    const apiList = apiRows(api.body.data);
    const apiCodes = apiList.map((r) => r.code).sort();
    assert.deepEqual(apiCodes, [child.code, grandparent.code, parent.code].sort(), "API must include the full ancestor chain");

    const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}`, token);
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.contentType, /spreadsheetml/);
    const xlsxList = (await readXlsxRows(xlsx.buffer)).filter((r) => r.code.startsWith(marker));
    assertRowsParity(
      apiList.filter((r) => r.code.startsWith(marker)),
      xlsxList,
      "inactive ancestors",
    );
    const gpRow = xlsxList.find((r) => r.code === grandparent.code);
    assert.ok(gpRow, "XLSX must include the inactive grandparent row");
    assert.equal(gpRow.closingDebit, 700, "XLSX grandparent must show recursive total");
  } finally {
    await cleanupAccounts([child.id, parent.id, grandparent.id]);
  }
});

test("P4 parity: identical filters (q, account_type, currency) produce identical rows in API and XLSX", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P4F${Date.now()}`;
  const parent = await prisma.account.create({
    data: { code: `${marker}PAR`.slice(0, 20), name: `${marker} parent`, accountType: "asset", isActive: true },
  });
  const child = await prisma.account.create({
    data: { code: `${marker}CHD`.slice(0, 20), name: `${marker} child`, accountType: "asset", isActive: true, parentId: parent.id },
  });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `${marker}-P`, lineNumber: 1, accountId: parent.id, debit: 400, credit: 0, currencyCode: "PKR", description: "P4 filter seed", entryDate: new Date("2026-07-11"), createdBy },
        { transactionId: `${marker}-C`, lineNumber: 1, accountId: child.id, debit: 250, credit: 0, currencyCode: "USD", description: "P4 filter seed", entryDate: new Date("2026-07-12"), createdBy },
        { transactionId: `${marker}-Y`, lineNumber: 1, accountId: child.id, debit: 100, credit: 0, currencyCode: "CNY", description: "P4 filter seed CNY", entryDate: new Date("2026-07-13"), createdBy },
      ],
    });

    const queries = [
      `q=${marker}`,
      `account_type=asset&q=${marker}`,
      `currency=USD&q=${marker}`,
      `currency=RMB`,
    ];
    for (const query of queries) {
      const api = await callApi(`/api/v1/trial-balance?${DATE_Q}&${query}`, token);
      assert.equal(api.status, 200, `API must accept ${query}`);
      const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}&${query}`, token);
      assert.equal(xlsx.status, 200, `export must accept ${query}`);
      const xlsxList = await readXlsxRows(xlsx.buffer);
      const apiList = apiRows(api.body.data);
      if (query.startsWith("q=")) {
        const markerRows = apiList.filter((r) => r.code.startsWith(marker));
        assertRowsParity(markerRows, xlsxList.filter((r) => r.code.startsWith(marker)), query);
      } else if (query === "currency=RMB") {
        // Legacy RMB param must resolve to the CNY rows in both outputs.
        assert.deepEqual(
          xlsxList.map((r) => `${r.code}|${r.currency}`).sort(),
          apiList.map((r) => `${r.code}|${r.currency}`).sort(),
          "currency=RMB must select identical rows in API and XLSX",
        );
      } else {
        assertRowsParity(apiList, xlsxList, query);
      }
    }
  } finally {
    await cleanupAccounts([child.id, parent.id]);
  }
});

test("P4 parity: grand totals by currency match between API and XLSX", async () => {
  const token = await superToken();
  const createdBy = await superadminId();
  const marker = `P4T${Date.now()}`;
  const account = await prisma.account.create({
    data: { code: `${marker}A`.slice(0, 20), name: `${marker} totals`, accountType: "asset", isActive: true },
  });
  try {
    await prisma.journalEntry.create({
      data: { transactionId: `${marker}-J`, lineNumber: 1, accountId: account.id, debit: 123.45, credit: 0, currencyCode: "PKR", description: "P4 totals seed", entryDate: new Date("2026-07-13"), createdBy },
    });
    const api = await callApi(`/api/v1/trial-balance?${DATE_Q}`, token);
    assert.equal(api.status, 200);
    const apiTotals = api.body.data.currencyTotals.PKR;
    assert.ok(apiTotals, "API PKR totals required");

    const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}`, token);
    assert.equal(xlsx.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.buffer as never);
    const sheet = workbook.worksheets[0];
    let xlsxTotal: { closingDebit?: number } | null = null;
    sheet.eachRow((values) => {
      const v = values.values as unknown[];
      if (v[1] === "PKR" && (v[2] === "" || v[2] == null)) {
        xlsxTotal = { closingDebit: Number(v[8] || 0) };
      }
    });
    assert.ok(xlsxTotal, "XLSX grand totals row for PKR required");
    assert.equal((xlsxTotal as { closingDebit?: number }).closingDebit, apiTotals.closingDebit, "PKR closing debit totals must match");
  } finally {
    await cleanupAccounts([account.id]);
  }
});

test("P4 parity: both routes return success for a valid city query with no city-specific rows", async () => {
  const token = await superToken();
  const city = await prisma.city.findFirst({ where: { name: "Quetta" } });
  assert.ok(city, "Seed city Quetta is required");
  const api = await callApi(`/api/v1/trial-balance?${DATE_Q}&city_id=${city.id}`, token);
  assert.equal(api.status, 200, "API must return 200 for a valid scoped query");
  const xlsx = await callExport(`/api/v1/trial-balance/export?${DATE_Q}&city_id=${city.id}`, token);
  assert.equal(xlsx.status, 200, "export must return 200 for the same valid scoped query");
  assert.match(xlsx.contentType, /spreadsheetml/);
});

test("P4 parity: hierarchy cycle is rejected by the export route with 400, never a 500", async () => {
  const token = await superToken();
  const marker = `P4Y${Date.now()}`;
  const a = await prisma.account.create({
    data: { code: `${marker}A`.slice(0, 20), name: `${marker} a`, accountType: "asset", isActive: true },
  });
  const b = await prisma.account.create({
    data: { code: `${marker}B`.slice(0, 20), name: `${marker} b`, accountType: "asset", isActive: true, parentId: a.id },
  });
  try {
    await prisma.account.update({ where: { id: a.id }, data: { parentId: b.id } });

    const api = await callApi(`/api/v1/trial-balance?${DATE_Q}`, token);
    assert.equal(api.status, 400, "API must reject the cycle");
    assert.equal(api.body.error?.code, "ACCOUNT_HIERARCHY_INVALID");

    const res = await exportTrialBalance(
      new NextRequest(`http://localhost/api/v1/trial-balance/export?${DATE_Q}`, { headers: { authorization: `Bearer ${token}` } }),
      { params: {} },
    );
    const raw = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 400, `export must reject the cycle with 400, got ${res.status}`);
    const body = JSON.parse(raw.toString("utf8"));
    assert.equal(body.error?.code, "ACCOUNT_HIERARCHY_INVALID", "export must return the structured hierarchy error");
  } finally {
    await cleanupAccounts([b.id, a.id]);
  }
});
