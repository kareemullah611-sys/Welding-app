import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { generateToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { POST as createBankDeposit } from "@/app/api/v1/bank-deposits/route";

test("bank deposit rejects invalid transferType before processing", async () => {
  const cityAdmin = await prisma.user.findFirst({
    where: { role: "city_admin", cityId: { not: null }, isActive: true },
    include: { city: true },
  });
  assert.ok(cityAdmin?.city, "An active city admin is required for this test");

  const token = generateToken({
    userId: cityAdmin.id,
    username: cityAdmin.username,
    role: "city_admin",
    cityId: cityAdmin.city.id,
    countryId: cityAdmin.city.countryId,
  });

  const request = new NextRequest("http://localhost/api/v1/bank-deposits", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transferType: "invalid_mode",
      bankAccountId: 1,
      depositDate: "2026-04-24",
      currencyId: 1,
      cashAmount: 1000,
      chequePaymentIds: [],
    }),
  });

  const response = await createBankDeposit(request, { params: {} });
  const json = (await response.json()) as any;

  assert.equal(response.status, 400);
  assert.equal(json.success, false);
  const errorText = String(json.error?.message || json.message || json.error || "");
  assert.match(errorText, /transferType/i);
});
