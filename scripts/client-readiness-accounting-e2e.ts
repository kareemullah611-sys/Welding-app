import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const EXPECTED_DB = "welding_app_client_readiness_e2e_20260923";
const RUN = process.env.E2E_RUN_ID || "CR-E2E-20260925";

type Check = { name: string; result: "PASS" | "FAIL"; detail: string };
const checks: Check[] = [];

function pass(name: string, detail: string) {
  checks.push({ name, result: "PASS", detail });
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  checks.push({ name, result: "FAIL", detail });
  console.error(`FAIL ${name}: ${detail}`);
  throw error;
}

function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL || "");
  const database = url.pathname.replace(/^\//, "");
  assert.equal(database, EXPECTED_DB, `Refusing to run against database ${database || "<missing>"}`);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), `Refusing non-local database host ${url.hostname}`);
  pass("database safety gate", `${url.hostname}/${database}`);
}

class ApiClient {
  private cookie = "";

  async login(username: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${username} login failed: ${JSON.stringify(body)}`);
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(this.cookie, `${username} login did not return a session cookie`);
    return body.data;
  }

  async request(method: string, path: string, payload?: unknown, expectedStatus?: number) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        cookie: this.cookie,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (expectedStatus !== undefined) {
      assert.equal(response.status, expectedStatus, `${method} ${path}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
    } else {
      assert.ok(response.ok, `${method} ${path}: ${response.status}: ${JSON.stringify(body)}`);
    }
    return { status: response.status, body };
  }
}

function dataOf(response: { body: any }) {
  return response.body?.data;
}

async function journalDifference() {
  const lines = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  return Math.round((Number(lines._sum.debit || 0) - Number(lines._sum.credit || 0)) * 100) / 100;
}

async function main() {
  assertDisposableDatabase();

  const baseline = {
    lots: await prisma.lot.count(),
    sales: await prisma.sale.count(),
    journals: await prisma.journalEntry.count(),
    participants: await prisma.investmentParticipant.count(),
  };
  assert.deepEqual(baseline, { lots: 0, sales: 0, journals: 0, participants: 0 });
  pass("clean disposable baseline", JSON.stringify(baseline));

  const superAdmin = new ApiClient();
  await superAdmin.login("superadmin", "admin1234");
  pass("superadmin authentication", "authenticated through /api/v1/auth/login");

  const [pk, af, pkr, afn, usd] = await Promise.all([
    prisma.country.findUniqueOrThrow({ where: { code: "PK" } }),
    prisma.country.findUniqueOrThrow({ where: { code: "AF" } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "AFN" } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "USD" } }),
  ]);
  pass("country and currency masters", "Pakistan, Afghanistan, PKR, AFN and USD present");

  const pkCityA = dataOf(await superAdmin.request("POST", "/api/v1/cities", {
    countryId: pk.id, name: `${RUN} Pakistan A`, currencyIds: [pkr.id, usd.id],
  }, 201));
  const pkCityB = dataOf(await superAdmin.request("POST", "/api/v1/cities", {
    countryId: pk.id, name: `${RUN} Pakistan B`, currencyIds: [pkr.id, usd.id],
  }, 201));
  const afCity = dataOf(await superAdmin.request("POST", "/api/v1/cities", {
    countryId: af.id, name: `${RUN} Afghanistan`, currencyIds: [afn.id, usd.id],
  }, 201));
  pass("dynamic cities", `created city IDs ${pkCityA.id}, ${pkCityB.id}, ${afCity.id}`);

  const adminPassword = "CityAudit123";
  const pkAdminA = dataOf(await superAdmin.request("POST", "/api/v1/users", {
    username: `${RUN.toLowerCase()}-pk-a`, password: adminPassword, fullName: `${RUN} PK Admin A`, role: "city_admin", cityId: pkCityA.id,
  }, 201));
  const pkAdminB = dataOf(await superAdmin.request("POST", "/api/v1/users", {
    username: `${RUN.toLowerCase()}-pk-b`, password: adminPassword, fullName: `${RUN} PK Admin B`, role: "city_admin", cityId: pkCityB.id,
  }, 201));
  const afAdmin = dataOf(await superAdmin.request("POST", "/api/v1/users", {
    username: `${RUN.toLowerCase()}-af`, password: adminPassword, fullName: `${RUN} AF Admin`, role: "city_admin", cityId: afCity.id,
  }, 201));
  pass("dynamic scoped users", `created user IDs ${pkAdminA.id}, ${pkAdminB.id}, ${afAdmin.id}`);

  const cityA = new ApiClient();
  const cityB = new ApiClient();
  const cityAf = new ApiClient();
  await cityA.login(pkAdminA.username, adminPassword);
  await cityB.login(pkAdminB.username, adminPassword);
  await cityAf.login(afAdmin.username, adminPassword);
  pass("city authentication", "all temporary city administrators authenticated");

  const godownA1 = dataOf(await cityA.request("POST", "/api/v1/godowns", { cityId: pkCityA.id, name: `${RUN} A Main` }, 201));
  const godownA2 = dataOf(await cityA.request("POST", "/api/v1/godowns", { cityId: pkCityA.id, name: `${RUN} A Secondary` }, 201));
  const godownB = dataOf(await cityB.request("POST", "/api/v1/godowns", { cityId: pkCityB.id, name: `${RUN} B Main` }, 201));
  const godownAf = dataOf(await cityAf.request("POST", "/api/v1/godowns", { cityId: afCity.id, name: `${RUN} AF Main` }, 201));
  pass("dynamic godowns", `created ${godownA1.id}, ${godownA2.id}, ${godownB.id}, ${godownAf.id}`);

  const product = dataOf(await superAdmin.request("POST", "/api/v1/products", {
    name: `${RUN} Welding 3.2mm`, unitOfMeasure: "MT", defaultWeightPerCartonKg: 20,
  }, 201));
  const replacementProduct = dataOf(await superAdmin.request("POST", "/api/v1/products", {
    name: `${RUN} Welding 4.0mm`, unitOfMeasure: "MT", defaultWeightPerCartonKg: 20,
  }, 201));
  const supplier = dataOf(await superAdmin.request("POST", "/api/v1/suppliers", {
    name: `${RUN} Supplier`, country: "China", contact: "audit-only",
  }, 201));
  const customerA = dataOf(await cityA.request("POST", "/api/v1/customers", {
    name: `${RUN} Customer A`, phone: "000000000", address: "Temporary audit record",
  }, 201));
  const customerAf = dataOf(await cityAf.request("POST", "/api/v1/customers", {
    name: `${RUN} Customer AF`, phone: "000000001", address: "Temporary audit record",
  }, 201));
  pass("products supplier customers", `products ${product.id}/${replacementProduct.id}, supplier ${supplier.id}, customers ${customerA.id}/${customerAf.id}`);

  await superAdmin.request("POST", "/api/v1/country-fallback-rates", {
    countryId: pk.id, fromCurrencyCode: "USD", toCurrencyCode: "PKR", rate: 283, effectiveFrom: "2026-09-01", notes: `${RUN} controlled fallback`,
  }, 201);
  pass("Pakistan fallback rate", "USD/PKR 283 effective 2026-09-01");

  const manager = dataOf(await superAdmin.request("POST", "/api/v1/investment-participants", {
    name: `${RUN} Manager`, type: "manager", effectiveDate: "2026-09-01", initialCapitalPkr: 15_000_000,
    investorProfitSharePercent: 100, managerProfitSharePercent: 0, reference: RUN,
  }, 201));
  const investor = dataOf(await superAdmin.request("POST", "/api/v1/investment-participants", {
    name: `${RUN} Investor Ali`, type: "investor", effectiveDate: "2026-09-01", initialCapitalPkr: 10_000_000,
    investorProfitSharePercent: 50, managerProfitSharePercent: 50, reference: RUN,
  }, 201));
  assert.equal(await prisma.investmentCapitalEvent.count(), 2);
  pass("manager and investor capital", `manager ${manager.id}=15m; investor ${investor.id}=10m at 50/50 profit split`);

  const lot = dataOf(await superAdmin.request("POST", "/api/v1/lots", {
    countryId: pk.id,
    destinationCityId: pkCityA.id,
    lotNumber: `${RUN}-LOT-001`,
    lotDate: "2026-09-10",
    shipmentStatus: "order_confirmed",
    notes: "Temporary client-readiness lot",
    purchaseItems: [{ supplierId: supplier.id, productId: product.id, qtyMt: 20, unitPriceUsdPerMt: 1000 }],
    distributions: [
      { cityId: pkCityA.id, productId: product.id, allocatedQty: 600 },
      { cityId: pkCityB.id, productId: product.id, allocatedQty: 200 },
    ],
  }, 201));
  assert.equal(Number(lot.pkrExchangeRate), 283);
  assert.equal(await prisma.lotProduct.count({ where: { lotId: lot.id, totalQty: 1000 } }), 1);
  assert.equal(await journalDifference(), 0);
  pass("lot purchase recognition", `lot ${lot.id}, 1,000 cartons, USD 20,000 at PKR 283, balanced journal`);

  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, { distributions: [] }, 400);
  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [{ cityId: pkCityA.id, productId: product.id, allocatedQty: 0 }],
  }, 400);
  pass("empty and zero distribution validation", "both requests rejected with HTTP 400");

  await cityA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: pkCityA.id, productId: product.id,
    allocations: [{ godownId: godownA1.id, qty: 400 }, { godownId: godownA2.id, qty: 200 }],
  });
  await cityB.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: pkCityB.id, productId: product.id,
    allocations: [{ godownId: godownB.id, qty: 200 }],
  });
  assert.equal(await prisma.lotCityGodownAllocation.count({ where: { productId: product.id } }), 3);
  pass("godown assignment", "600 cartons assigned across two source godowns and 200 to destination city");

  await cityA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: pkCityA.id, productId: product.id,
    allocations: [{ godownId: godownA1.id, qty: 600 }],
  });
  assert.equal(await prisma.lotCityGodownAllocation.count({ where: { lotCityDistribution: { lotId: lot.id, cityId: pkCityA.id }, productId: product.id } }), 1);
  await cityA.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: pkCityA.id, productId: product.id,
    allocations: [{ godownId: godownA1.id, qty: 400 }, { godownId: godownA2.id, qty: 200 }],
  });
  pass("assignment reversal and restoration", "stale assignment removed, then original two-godown assignment restored");

  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [{ cityId: pkCityA.id, productId: product.id, allocatedQty: 600 }],
  });
  assert.equal(await prisma.lotCityDistribution.count({ where: { lotId: lot.id } }), 1);
  await superAdmin.request("PUT", `/api/v1/lots/${lot.id}/distribute`, {
    distributions: [
      { cityId: pkCityA.id, productId: product.id, allocatedQty: 600 },
      { cityId: pkCityB.id, productId: product.id, allocatedQty: 200 },
    ],
  });
  await cityB.request("POST", `/api/v1/lots/${lot.id}/godown-allocation`, {
    cityId: pkCityB.id, productId: product.id,
    allocations: [{ godownId: godownB.id, qty: 200 }],
  });
  pass("distribution reversal and restoration", "stale city distribution deleted, then recreated and reassigned");

  const rejectedTransfer = dataOf(await cityA.request("POST", "/api/v1/city-transfers", {
    toCityId: pkCityB.id, fromGodownId: godownA1.id, productId: product.id, lotId: lot.id,
    qty: 10, transferDate: "2026-09-12", notes: `${RUN} rejection path`,
  }, 201));
  await cityB.request("PUT", `/api/v1/city-transfers/${rejectedTransfer.id}`, { action: "reject", approvalNotes: "controlled rejection" });
  assert.equal((await prisma.cityTransfer.findUniqueOrThrow({ where: { id: rejectedTransfer.id } })).status, "rejected");

  const approvedTransfer = dataOf(await cityA.request("POST", "/api/v1/city-transfers", {
    toCityId: pkCityB.id, fromGodownId: godownA1.id, productId: product.id, lotId: lot.id,
    qty: 50, transferDate: "2026-09-12", notes: `${RUN} approval path`,
  }, 201));
  await cityB.request("PUT", `/api/v1/city-transfers/${approvedTransfer.id}`, { action: "approve", toGodownId: godownB.id, approvalNotes: "controlled approval" });
  const approved = await prisma.cityTransfer.findUniqueOrThrow({ where: { id: approvedTransfer.id } });
  assert.equal(approved.status, "approved");
  const sourceAllocation = await prisma.lotCityGodownAllocation.findFirstOrThrow({ where: { godownId: godownA1.id, productId: product.id } });
  const targetAllocation = await prisma.lotCityGodownAllocation.findFirstOrThrow({ where: { godownId: godownB.id, productId: product.id } });
  assert.equal(Number(sourceAllocation.qty), 350);
  assert.equal(Number(targetAllocation.qty), 250);
  pass("city transfer reject and approve", "rejection preserved stock; approval moved exactly 50 cartons source-to-destination");

  assert.equal(await journalDifference(), 0);
  pass("global debit-credit equality", "journal debit minus credit = 0.00");

  console.log(`RESULT ${JSON.stringify({ run: RUN, checks, ids: { pkCityA: pkCityA.id, pkCityB: pkCityB.id, afCity: afCity.id, lot: lot.id, product: product.id, manager: manager.id, investor: investor.id } }, null, 2)}`);
}

main()
  .catch((error) => {
    fail("audit runner", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
