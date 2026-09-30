import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getTrialBalance } from "@/app/api/v1/trial-balance/route";
import { GET as exportTrialBalance } from "@/app/api/v1/trial-balance/export/route";
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

async function call(route: (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>, path: string, token: string) {
  const res = await route(
    new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: {} },
  );
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  return { status: res.status, contentType, body: isJson ? await res.json() : null };
}

function assertValidationError(res: { status: number; body: unknown }, label: string) {
  assert.equal(res.status, 400, `${label}: expected structured 400, got ${res.status}`);
  const body = res.body as { success?: boolean; error?: { code?: string } };
  assert.equal(body?.success, false, `${label}: body must be a structured error`);
  assert.equal(body?.error?.code, "VALIDATION_ERROR", `${label}: error code must be VALIDATION_ERROR`);
}

test("P3 matrix: Trial Balance API rejects malformed and impossible dates with 400 (never 500)", async () => {
  const token = await superToken();
  const malformed = await call(getTrialBalance, "/api/v1/trial-balance?date_from=garbage&date_to=2026-01-31", token);
  assertValidationError(malformed, "TB malformed date_from");

  const impossible = await call(getTrialBalance, "/api/v1/trial-balance?date_from=2026-02-30&date_to=2026-03-31", token);
  assertValidationError(impossible, "TB impossible calendar date");

  const badToDate = await call(getTrialBalance, "/api/v1/trial-balance?date_from=2026-01-01&date_to=13-13-13", token);
  assertValidationError(badToDate, "TB malformed date_to");
});

test("P3 matrix: Trial Balance API rejects unknown city ids and bad formats with 400", async () => {
  const token = await superToken();
  const missingCity = await call(getTrialBalance, "/api/v1/trial-balance?date_from=2026-01-01&date_to=2026-12-31&city_id=99999", token);
  assertValidationError(missingCity, "TB nonexistent city");

  const badCity = await call(getTrialBalance, "/api/v1/trial-balance?date_from=2026-01-01&date_to=2026-12-31&city_id=abc", token);
  assertValidationError(badCity, "TB non-numeric city");
});

test("P3 matrix: Trial Balance API accepts valid dates and an existing city", async () => {
  const token = await superToken();
  const city = await prisma.city.findFirst({ where: { name: "Quetta" } });
  assert.ok(city, "Seed city Quetta is required");
  const valid = await call(
    getTrialBalance,
    `/api/v1/trial-balance?date_from=2026-01-01&date_to=2026-12-31&city_id=${city.id}`,
    token,
  );
  assert.equal(valid.status, 200, `valid city must be accepted, got ${valid.status}`);
  assert.equal(valid.body?.success, true);

  const missingDates = await call(getTrialBalance, "/api/v1/trial-balance", token);
  assertValidationError(missingDates, "TB missing dates");
});

test("P3 matrix: XLSX export rejects malformed dates and invalid cities with 400", async () => {
  const token = await superToken();
  const malformed = await call(exportTrialBalance, "/api/v1/trial-balance/export?date_from=garbage&date_to=2026-01-31", token);
  assertValidationError(malformed, "export malformed date");

  const impossible = await call(exportTrialBalance, "/api/v1/trial-balance/export?date_from=2026-02-30&date_to=2026-03-31", token);
  assertValidationError(impossible, "export impossible date");

  const badCity = await call(exportTrialBalance, "/api/v1/trial-balance/export?date_from=2026-01-01&date_to=2026-12-31&city_id=abc", token);
  assertValidationError(badCity, "export non-numeric city (must not silently mean all cities)");

  const missingCity = await call(exportTrialBalance, "/api/v1/trial-balance/export?date_from=2026-01-01&date_to=2026-12-31&city_id=99999", token);
  assertValidationError(missingCity, "export nonexistent city");
});

test("P3 matrix: XLSX export still returns a workbook for valid parameters", async () => {
  const token = await superToken();
  const valid = await call(exportTrialBalance, "/api/v1/trial-balance/export?date_from=2026-01-01&date_to=2026-12-31", token);
  assert.equal(valid.status, 200, `valid export must return 200, got ${valid.status}`);
  assert.match(valid.contentType, /spreadsheetml/, "valid export must return an xlsx workbook");
});

test("P3 matrix: account ledger rejects bad city ids and bad dates with 400", async () => {
  const token = await superToken();
  const account = await prisma.account.findFirst();
  assert.ok(account, "At least one account is required");

  const badCity = await call(getLedger, `/api/v1/account-ledger?account_id=${account.id}&city_id=abc`, token);
  assertValidationError(badCity, "ledger non-numeric city");

  const missingCity = await call(getLedger, `/api/v1/account-ledger?account_id=${account.id}&city_id=99999`, token);
  assertValidationError(missingCity, "ledger nonexistent city");

  const badDate = await call(getLedger, `/api/v1/account-ledger?account_id=${account.id}&date_from=not-a-date`, token);
  assertValidationError(badDate, "ledger malformed date_from");

  const badDateTo = await call(getLedger, `/api/v1/account-ledger?account_id=${account.id}&date_to=2026-02-30`, token);
  assertValidationError(badDateTo, "ledger impossible date_to");
});

test("P3 matrix: account ledger still serves valid requests", async () => {
  const token = await superToken();
  const account = await prisma.account.findFirst();
  assert.ok(account, "At least one account is required");
  const valid = await call(getLedger, `/api/v1/account-ledger?account_id=${account.id}`, token);
  assert.equal(valid.status, 200, `valid ledger request must return 200, got ${valid.status}`);
  assert.equal(valid.body?.success, true);
});
