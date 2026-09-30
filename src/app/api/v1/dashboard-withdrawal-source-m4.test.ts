import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as dashboard } from "@/app/api/v1/dashboard/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function readDashboard(token: string) {
  const res = await dashboard(new NextRequest("http://localhost/api/v1/dashboard", { headers: authHeaders(token) }), { params: {} });
  const json = (await res.json()) as any;
  assert.equal(res.status, 200, `dashboard must load: ${JSON.stringify(json)}`);
  return json.data;
}

test("M4: dashboard cash position subtracts only cash-office withdrawals; widget totals include all", async () => {
  const marker = `m4-${Date.now()}`;
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(admin, "Seed user quetta_admin is required");
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");

  const cityToken = generateToken({
    userId: admin.id, username: admin.username, role: "city_admin",
    cityId: city.id, countryId: city.countryId,
  });
  const superToken = generateToken({
    userId: superadmin.id, username: superadmin.username, role: "super_admin",
    cityId: null, countryId: null,
  });

  const beforeCity = await readDashboard(cityToken);
  const beforeSuper = await readDashboard(superToken);
  const beforeSuperRow = (beforeSuper.citiesOverview as any[]).find((c) => c.cityId === city.id);
  assert.ok(beforeSuperRow, "super admin overview must include Quetta");

  let cashWd = 0;
  let bankWd = 0;
  try {
    cashWd = (await prisma.personalWithdrawal.create({
      data: { cityId: city.id, withdrawalDate: new Date("2026-04-24"), amount: 100, currencyId: pkr.id, detail: `${marker}-cash-office`, sourceType: "cash_office", createdBy: admin.id },
    })).id;
    bankWd = (await prisma.personalWithdrawal.create({
      data: { cityId: city.id, withdrawalDate: new Date("2026-04-24"), amount: 40, currencyId: pkr.id, detail: `${marker}-bank`, sourceType: "bank_account", createdBy: admin.id },
    })).id;

    const afterCity = await readDashboard(cityToken);
    const afterSuper = await readDashboard(superToken);
    const afterSuperRow = (afterSuper.citiesOverview as any[]).find((c) => c.cityId === city.id);
    assert.ok(afterSuperRow, "super admin overview must include Quetta");

    const wdDelta = Number(afterCity.withdrawalByCurrency.PKR || 0) - Number(beforeCity.withdrawalByCurrency.PKR || 0);
    assert.equal(wdDelta, 140, "withdrawal widget must sum ALL sources (cash_office + bank_account)");

    const cashDelta = Number(afterCity.cashPositionByCurrency.PKR || 0) - Number(beforeCity.cashPositionByCurrency.PKR || 0);
    assert.equal(cashDelta, -100, "city cash position must subtract only cash_office withdrawals (not bank_account)");

    const superWdDelta = Number(afterSuperRow.withdrawalByCurrency.PKR || 0) - Number(beforeSuperRow.withdrawalByCurrency.PKR || 0);
    assert.equal(superWdDelta, 140, "super admin per-city withdrawal total must include ALL sources");

    const superCashDelta = Number(afterSuperRow.cashByCurrency.PKR || 0) - Number(beforeSuperRow.cashByCurrency.PKR || 0);
    assert.equal(superCashDelta, -100, "super admin per-city cash must subtract only cash_office withdrawals");
  } finally {
    await prisma.personalWithdrawal.deleteMany({ where: { id: { in: [cashWd, bankWd].filter(Boolean) } } });
  }
});
