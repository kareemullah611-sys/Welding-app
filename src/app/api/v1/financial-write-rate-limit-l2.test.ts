import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createPayment } from "@/app/api/v1/payments/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("L2: financial write endpoints enforce the env-tunable rate limit", async () => {
  process.env.FIN_RATE_LIMIT = "2";
  try {
    const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
    assert.ok(city, "Seed city Quetta (PK) is required");
    const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
    assert.ok(admin, "Seed user quetta_admin is required");
    const token = generateToken({
      userId: admin.id, username: admin.username, role: "city_admin",
      cityId: city.id, countryId: city.countryId,
    });

    const call = () => createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({}),
      }),
      { params: {} }
    );

    const first = await call();
    assert.notEqual(first.status, 429, "request 1 must pass the rate limit");
    const second = await call();
    assert.notEqual(second.status, 429, "request 2 must pass the rate limit (limit=2)");

    const third = await call();
    assert.equal(third.status, 429, "request 3 must be rate limited with FIN_RATE_LIMIT=2");
    const json = (await third.json()) as any;
    assert.equal(json.error, "RATE_LIMITED");
    assert.ok(third.headers.get("Retry-After"), "429 must carry Retry-After");
  } finally {
    delete process.env.FIN_RATE_LIMIT;
  }
});
