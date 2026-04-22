import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getWithdrawalNames } from "@/app/api/v1/personal-withdrawals/names/route";

test("city-admin withdrawal names endpoint returns unique filtered names", async () => {
  const marker = `wd-name-${Date.now()}`;

  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const currency = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(currency, "Seed currency PKR is required for this test");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  const created = await prisma.personalWithdrawal.createManyAndReturn({
    data: [
      {
        cityId: city.id,
        withdrawalDate: new Date("2026-04-22"),
        amount: 1000,
        currencyId: currency.id,
        detail: `${marker}-1`,
        withdrawnBy: "Ishaq Feroz",
        createdBy: user.id,
      },
      {
        cityId: city.id,
        withdrawalDate: new Date("2026-04-22"),
        amount: 1200,
        currencyId: currency.id,
        detail: `${marker}-2`,
        withdrawnBy: "ishaq feroz",
        createdBy: user.id,
      },
      {
        cityId: city.id,
        withdrawalDate: new Date("2026-04-22"),
        amount: 1500,
        currencyId: currency.id,
        detail: `${marker}-3`,
        withdrawnBy: "Abdul Malik",
        createdBy: user.id,
      },
    ],
    select: { id: true },
  });

  try {
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: "city_admin",
      cityId: city.id,
      countryId: city.countryId,
    });
    const headers = { authorization: `Bearer ${token}` };

    const request = new NextRequest("http://localhost/api/v1/personal-withdrawals/names?q=ish", { headers });
    const response = await getWithdrawalNames(request, { params: {} });
    const json = (await response.json()) as any;

    assert.equal(response.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.data, ["Ishaq Feroz"]);
  } finally {
    await prisma.personalWithdrawal.deleteMany({
      where: { id: { in: created.map((item) => item.id) } },
    });
  }
});
