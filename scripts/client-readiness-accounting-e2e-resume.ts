import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const EXPECTED_DB = "welding_app_client_readiness_e2e_20260923";
const RUN = process.env.E2E_RUN_ID || "CR-E2E-20260925";

class ApiClient {
  private cookie = "";
  async login(username: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${username} login failed: ${JSON.stringify(body)}`);
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  }
  async request(method: string, path: string, payload?: unknown, expectedStatus?: number) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), cookie: this.cookie },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body?.data;
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), EXPECTED_DB);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));

  const [cityA, cityB, product, lot, adminA, adminB] = await Promise.all([
    prisma.city.findFirstOrThrow({ where: { name: `${RUN} Pakistan A` } }),
    prisma.city.findFirstOrThrow({ where: { name: `${RUN} Pakistan B` } }),
    prisma.product.findFirstOrThrow({ where: { name: `${RUN} Welding 3.2mm` } }),
    prisma.lot.findFirstOrThrow({ where: { lotNumber: `${RUN}-LOT-001` } }),
    prisma.user.findFirstOrThrow({ where: { username: `${RUN.toLowerCase()}-pk-a` } }),
    prisma.user.findFirstOrThrow({ where: { username: `${RUN.toLowerCase()}-pk-b` } }),
  ]);
  const [godownA1, godownA2, godownB] = await Promise.all([
    prisma.godown.findFirstOrThrow({ where: { cityId: cityA.id, name: `${RUN} A Main` } }),
    prisma.godown.findFirstOrThrow({ where: { cityId: cityA.id, name: `${RUN} A Secondary` } }),
    prisma.godown.findFirstOrThrow({ where: { cityId: cityB.id, name: `${RUN} B Main` } }),
  ]);

  const superAdmin = new ApiClient();
  const clientA = new ApiClient();
  const clientB = new ApiClient();
  await superAdmin.login("superadmin", "admin1234");
  await clientA.login(adminA.username, "CityAudit123");
  await clientB.login(adminB.username, "CityAudit123");

  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, { distributions: [] }, 400);
  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [{ cityId: cityA.id, productId: product.id, allocatedQty: 0 }],
  }, 400);
  console.log("PASS empty and zero distributions rejected");

  await clientA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: cityA.id, productId: product.id,
    allocations: [{ godownId: godownA1.id, qty: 400 }, { godownId: godownA2.id, qty: 200 }],
  });
  await clientB.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: cityB.id, productId: product.id, allocations: [{ godownId: godownB.id, qty: 200 }],
  });
  console.log("PASS initial godown assignments");

  await clientA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: cityA.id, productId: product.id, allocations: [{ godownId: godownA1.id, qty: 600 }],
  });
  assert.equal(await prisma.lotCityGodownAllocation.count({ where: { lotCityDistribution: { lotId: lot.id, cityId: cityA.id } } }), 1);
  await clientA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: cityA.id, productId: product.id,
    allocations: [{ godownId: godownA1.id, qty: 400 }, { godownId: godownA2.id, qty: 200 }],
  });
  console.log("PASS assignment replacement removes stale row and restores exactly");

  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [{ cityId: cityA.id, productId: product.id, allocatedQty: 600 }],
  });
  assert.equal(await prisma.lotCityDistribution.count({ where: { lotId: lot.id } }), 1);
  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [
      { cityId: cityA.id, productId: product.id, allocatedQty: 600 },
      { cityId: cityB.id, productId: product.id, allocatedQty: 200 },
    ],
  });
  await clientB.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: cityB.id, productId: product.id, allocations: [{ godownId: godownB.id, qty: 200 }],
  });
  console.log("PASS distribution replacement deletes stale city and restores it");

  const rejected = await clientA.request("POST", "/api/v1/city-transfers", {
    toCityId: cityB.id, fromGodownId: godownA1.id, productId: product.id, lotId: lot.id,
    qty: 10, transferDate: "2026-09-12", notes: `${RUN} reject`,
  }, 201);
  await clientB.request("PUT", `/api/v1/city-transfers/${rejected.id}`, { action: "reject", approvalNotes: "controlled reject" });
  assert.equal((await prisma.cityTransfer.findUniqueOrThrow({ where: { id: rejected.id } })).status, "rejected");
  console.log("PASS rejected transfer leaves stock unchanged");

  const approved = await clientA.request("POST", "/api/v1/city-transfers", {
    toCityId: cityB.id, fromGodownId: godownA1.id, productId: product.id, lotId: lot.id,
    qty: 50, transferDate: "2026-09-12", notes: `${RUN} approve`,
  }, 201);
  await clientB.request("PUT", `/api/v1/city-transfers/${approved.id}`, { action: "approve", toGodownId: godownB.id, approvalNotes: "controlled approve" });
  const [source, target] = await Promise.all([
    prisma.lotCityGodownAllocation.findFirstOrThrow({ where: { godownId: godownA1.id, productId: product.id } }),
    prisma.lotCityGodownAllocation.findFirstOrThrow({ where: { godownId: godownB.id, productId: product.id } }),
  ]);
  assert.equal(Number(source.qty), 350);
  assert.equal(Number(target.qty), 250);
  console.log("PASS approved city transfer moves exactly 50 cartons");

  const journals = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(journals._sum.debit || 0), Number(journals._sum.credit || 0));
  console.log(`PASS journals balance at PKR ${Number(journals._sum.debit || 0).toFixed(2)}`);
}

main().finally(() => prisma.$disconnect());
