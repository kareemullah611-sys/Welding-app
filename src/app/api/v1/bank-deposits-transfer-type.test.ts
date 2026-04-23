import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { generateToken } from "@/lib/auth";
import { POST as createBankDeposit } from "@/app/api/v1/bank-deposits/route";

test("bank deposit rejects invalid transferType before processing", async () => {
  const token = generateToken({
    userId: 1,
    username: "city_admin_test",
    role: "city_admin",
    cityId: 1,
    countryId: 1,
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
