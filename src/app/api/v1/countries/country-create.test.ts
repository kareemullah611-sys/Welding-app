import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import * as routes from "./route";

test("country creation is authorized, validated, audited and duplicate-safe", async (t) => {
  const post = (routes as Record<string, unknown>).POST as typeof routes.GET;
  assert.equal(typeof post, "function", "Countries needs a POST route");
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.match(target.pathname, /country_creation/);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "superadmin" } });
  const city = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" }, include: { city: true } });
  const token = (u: typeof admin, countryId: number | null = null) => generateToken({
    userId: u.id, username: u.username, role: u.role, cityId: u.cityId, countryId,
  });
  const call = (body: unknown, auth = token(admin), origin?: string) => post(new NextRequest("http://localhost/api/v1/countries", {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }), { params: {} });
  const name = "Country creation regression";
  let failAudit = false;
  prisma.$use(async (params, next) => {
    if (failAudit && params.model === "AuditLog" && params.action === "create" && params.args.data.entityType === "countries") {
      throw new Error("Simulated audit failure");
    }
    return next(params);
  });
  try {
    await t.test("normalizes and persists country with audit", async () => {
      const response = await call({ name: `  ${name}  `, code: " zx " });
      assert.equal(response.status, 201);
      const { data } = await response.json();
      assert.equal(data.name, name);
      assert.equal(data.code, "ZX");
      assert.equal(data.citiesCount, 0);
      const row = await prisma.country.findUniqueOrThrow({ where: { id: data.id } });
      assert.equal(row.code, "ZX");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "countries", entityId: row.id, action: "create" } });
      assert.equal(audit.userId, admin.id);
      assert.deepEqual(audit.newValues, { name, code: "ZX" });
      const listed = await routes.GET(new NextRequest("http://localhost/api/v1/countries", { headers: { authorization: `Bearer ${token(admin)}` } }), { params: {} });
      assert.ok((await listed.json()).data.some((r: { id: number }) => r.id === row.id));
    });
    await t.test("rejects duplicate names and codes", async () => {
      assert.equal((await call({ name: name.toUpperCase(), code: "ZY" })).status, 409);
      assert.equal((await call({ name: "Another country", code: "zx" })).status, 409);
      const responses = await Promise.all([call({ name: "Concurrent country", code: "ZY" }), call({ name: "CONCURRENT COUNTRY", code: "ZZ" })]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    });
    await t.test("rejects malformed input", async () => {
      for (const body of [null, {}, { name: " ", code: "US" }, { name: "x".repeat(101), code: "US" }, { name, code: "USA" }, { name, code: "12" }, { name, code: "US", baseCurrency: "USD" }]) {
        assert.equal((await call(body)).status, 400);
      }
      const response = await post(new NextRequest("http://localhost/api/v1/countries", { method: "POST", headers: { authorization: `Bearer ${token(admin)}`, "content-type": "application/json" }, body: "{" }), { params: {} });
      assert.equal(response.status, 400);
    });
    await t.test("requires superadmin and safe origin", async () => {
      assert.equal((await call({ name, code: "ZX" }, "")).status, 401);
      assert.equal((await call({ name, code: "ZX" }, token(city, city.city!.countryId))).status, 403);
      const csrf = await post(new NextRequest("http://localhost/api/v1/countries", {
        method: "POST", headers: { cookie: `token=${token(admin)}`, origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ name, code: "ZX" }),
      }), { params: {} });
      assert.equal(csrf.status, 403);
    });
    await t.test("rolls back country creation when its audit cannot be saved", async () => {
      failAudit = true;
      try {
        assert.equal((await call({ name: "Rollback country", code: "ZU" })).status, 500);
        assert.equal(await prisma.country.count({ where: { code: "ZU" } }), 0);
      } finally {
        failAudit = false;
      }
    });
  } finally {
    const rows = await prisma.country.findMany({ where: { code: { in: ["ZX", "ZY", "ZZ", "ZU"] } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "countries", entityId: { in: rows.map(r => r.id) } } });
    await prisma.country.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
    await prisma.$disconnect();
  }
});
