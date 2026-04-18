import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { generateToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GET as getExpenses } from "@/app/api/v1/expenses/route";
import { GET as getPersonalWithdrawals } from "@/app/api/v1/personal-withdrawals/route";

test("city-admin amount search matches integer text in expenses and personal withdrawals", async () => {
  const marker = `city-fin-search-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
    include: { country: true },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const currency = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(currency, "Seed currency PKR is required for this test");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: currency.id } },
    update: {},
    create: { cityId: city.id, currencyId: currency.id },
  });

  const lot = await prisma.lot.create({
    data: {
      countryId: city.countryId,
      lotNumber: `${marker}-lot`,
      lotDate: new Date("2026-04-01"),
      status: "ongoing",
      createdBy: user.id,
    },
  });

  const expense = await prisma.expense.create({
    data: {
      cityId: city.id,
      lotId: lot.id,
      expenseDate: new Date("2026-04-10"),
      amount: 456.78,
      currencyId: currency.id,
      detail: `${marker}-expense`,
      createdBy: user.id,
    },
  });

  const withdrawal = await prisma.personalWithdrawal.create({
    data: {
      cityId: city.id,
      withdrawalDate: new Date("2026-04-11"),
      amount: 321.45,
      currencyId: currency.id,
      detail: `${marker}-withdrawal`,
      createdBy: user.id,
    },
  });

  try {
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: "city_admin",
      cityId: city.id,
      countryId: city.countryId,
    });
    const authHeaders = { authorization: `Bearer ${token}` };

    const expensesRequest = new NextRequest(
      "http://localhost/api/v1/expenses?q=456&page=1&limit=20",
      { headers: authHeaders },
    );
    const expensesResponse = await getExpenses(expensesRequest, { params: {} });
    const expensesJson = (await expensesResponse.json()) as any;
    assert.equal(expensesResponse.status, 200);
    assert.equal(expensesJson.success, true);
    assert.equal(
      expensesJson.data.some((item: any) => item.id === expense.id),
      true,
      "Expense should match when searching amount-column numeric text (456)",
    );

    const withdrawalsRequest = new NextRequest(
      "http://localhost/api/v1/personal-withdrawals?q=321&page=1&limit=20",
      { headers: authHeaders },
    );
    const withdrawalsResponse = await getPersonalWithdrawals(withdrawalsRequest, { params: {} });
    const withdrawalsJson = (await withdrawalsResponse.json()) as any;
    assert.equal(withdrawalsResponse.status, 200);
    assert.equal(withdrawalsJson.success, true);
    assert.equal(
      withdrawalsJson.data.some((item: any) => item.id === withdrawal.id),
      true,
      "Personal withdrawal should match when searching amount-column numeric text (321)",
    );
  } finally {
    await prisma.expense.deleteMany({ where: { id: expense.id } });
    await prisma.personalWithdrawal.deleteMany({ where: { id: withdrawal.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
  }
});
