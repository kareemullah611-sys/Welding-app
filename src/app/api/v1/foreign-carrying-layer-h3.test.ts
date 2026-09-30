import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { checkCarryingLayerWired } from "@/lib/foreign-currency-carrying";
import { POST as createPayment } from "@/app/api/v1/payments/route";
import { POST as createExpense } from "@/app/api/v1/expenses/route";
import { POST as createSale } from "@/app/api/v1/sales/route";
import { PATCH as updateCity } from "@/app/api/v1/cities/[id]/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function seedBase() {
  const quetta = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(quetta, "Seed city Quetta (PK) is required");
  const kandahar = await prisma.city.findFirst({ where: { name: "Kandahar", country: { code: "AF" } } });
  assert.ok(kandahar, "Seed city Kandahar (AF) is required");
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  const quettaAdmin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(quettaAdmin, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  const usd = await prisma.currency.findUnique({ where: { code: "USD" } });
  assert.ok(usd, "Seed currency USD is required");
  const afn = await prisma.currency.findUnique({ where: { code: "AFN" } });
  assert.ok(afn, "Seed currency AFN is required");

  const superToken = generateToken({
    userId: superadmin.id,
    username: superadmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
  const cityToken = generateToken({
    userId: quettaAdmin.id,
    username: quettaAdmin.username,
    role: "city_admin",
    cityId: quetta.id,
    countryId: quetta.countryId,
  });
  return { quetta, kandahar, pkr, usd, afn, superToken, cityToken, adminId: quettaAdmin.id };
}

test("H3 helper: gate accepts PKR and wired AF foreign, blocks unwired combos", () => {
  assert.equal(checkCarryingLayerWired(false, "PKR").ok, true, "PKR is always wired");
  assert.equal(checkCarryingLayerWired(true, "PKR").ok, true, "PKR is always wired (AF too)");
  assert.equal(checkCarryingLayerWired(true, "USD").ok, true, "AF + supported foreign is wired");
  assert.equal(checkCarryingLayerWired(true, "AFN").ok, true, "AF + AFN is wired");
  assert.equal(checkCarryingLayerWired(false, "USD").ok, false, "PK + USD is NOT wired");
  assert.equal(checkCarryingLayerWired(true, "EUR").ok, false, "AF + unsupported code is NOT wired");
});

test("H3: payment POST in a non-wired foreign currency is rejected with FOREIGN_CARRYING_LAYER_REQUIRED", async () => {
  const marker = `h3-pay-${Date.now()}`;
  const { quetta, pkr, usd, cityToken } = await seedBase();
  const customer = await prisma.customer.create({
    data: { cityId: quetta.id, name: marker, isActive: true },
  });
  // Bypass state a bad city update (or direct data change) could create:
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: quetta.id, currencyId: usd.id } },
    update: {},
    create: { cityId: quetta.id, currencyId: usd.id },
  });

  try {
    const res = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST",
        headers: authHeaders(cityToken),
        body: JSON.stringify({
          customerId: customer.id,
          paymentDate: "2026-04-24",
          detail: marker,
          amount: 100,
          currencyId: usd.id,
          paymentMethod: "cash",
          destination: "our_account",
        }),
      }),
      { params: {} }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 409, `unwired USD payment must be rejected: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "FOREIGN_CARRYING_LAYER_REQUIRED");
    assert.equal(await prisma.payment.count({ where: { detail: marker } }), 0, "no payment row may be created");
  } finally {
    const rows = await prisma.payment.findMany({ where: { detail: marker }, select: { id: true } });
    for (const row of rows) {
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`PAY-${row.id}`, `REV-PAY-${row.id}`] } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "payments", entityId: row.id } });
      await prisma.payment.deleteMany({ where: { id: row.id } });
    }
    await prisma.cityCurrency.deleteMany({ where: { cityId: quetta.id, currencyId: usd.id } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    void pkr;
  }
});

test("H3: expense POST in a non-wired foreign currency is rejected with FOREIGN_CARRYING_LAYER_REQUIRED", async () => {
  const marker = `h3-exp-${Date.now()}`;
  const { quetta, usd, cityToken } = await seedBase();
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: quetta.id, currencyId: usd.id } },
    update: {},
    create: { cityId: quetta.id, currencyId: usd.id },
  });

  try {
    const res = await createExpense(
      new NextRequest("http://localhost/api/v1/expenses", {
        method: "POST",
        headers: authHeaders(cityToken),
        body: JSON.stringify({
          expenseDate: "2026-04-24",
          amount: 100,
          currencyId: usd.id,
          detail: marker,
          paidFrom: "cash_office",
        }),
      }),
      { params: {} }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 409, `unwired USD expense must be rejected: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "FOREIGN_CARRYING_LAYER_REQUIRED");
    assert.equal(await prisma.expense.count({ where: { detail: marker } }), 0, "no expense row may be created");
  } finally {
    const created = await prisma.expense.findMany({ where: { detail: marker }, select: { id: true } });
    for (const row of created) {
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`EXP-${row.id}`, `REV-EXP-${row.id}`] } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "expenses", entityId: row.id } });
      await prisma.expense.deleteMany({ where: { id: row.id } });
    }
    await prisma.cityCurrency.deleteMany({ where: { cityId: quetta.id, currencyId: usd.id } });
  }
});

test("H3: sale POST in a non-wired foreign currency is rejected with FOREIGN_CARRYING_LAYER_REQUIRED", async () => {
  const marker = `h3-sale-${Date.now()}`;
  const { quetta, pkr, usd, cityToken, adminId } = await seedBase();
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const customer = await prisma.customer.create({ data: { cityId: quetta.id, name: `${marker}-customer`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: quetta.id, name: `${marker}-godown`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: quetta.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: adminId },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: { lotId: lot.id, cityId: quetta.id, productId: product.id, allocatedQty: 100 },
  });
  const allocation = await prisma.lotCityGodownAllocation.create({
    data: { lotCityDistributionId: distribution.id, godownId: godown.id, productId: product.id, qty: 100 },
  });
  const valuation = await prisma.openingInventoryValuation.create({
    data: {
      lotId: lot.id,
      productId: product.id,
      quantity: 100,
      unitCostPkr: 50,
      totalValuePkr: 5000,
      openingDate: new Date("2026-04-01"),
      createdBy: adminId,
    },
  });
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: quetta.id, currencyId: usd.id } },
    update: {},
    create: { cityId: quetta.id, currencyId: usd.id },
  });

  const cleanupSaleRows = async () => {
    const leftover = await prisma.sale.findMany({ where: { cityId: quetta.id, currencyId: usd.id }, select: { id: true } });
    const saleIds = leftover.map((row) => row.id);
    if (saleIds.length) {
      await prisma.journalEntry.deleteMany({ where: { entityType: "sale", entityId: { in: saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    }
    return saleIds.length;
  };

  try {
    const res = await createSale(
      new NextRequest("http://localhost/api/v1/sales", {
        method: "POST",
        headers: authHeaders(cityToken),
        body: JSON.stringify({
          godownId: godown.id,
          saleDate: "2026-04-24",
          currencyId: usd.id,
          customerId: customer.id,
          items: [{ productId: product.id, lotId: lot.id, qty: 1, ratePerCarton: 100, amount: 100 }],
        }),
      }),
      { params: {} }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 409, `unwired USD sale must be rejected: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "FOREIGN_CARRYING_LAYER_REQUIRED");
    assert.equal(await cleanupSaleRows(), 0, "no sale row may be created");
  } finally {
    await cleanupSaleRows();
    await prisma.cityCurrency.deleteMany({ where: { cityId: quetta.id, currencyId: usd.id } });
    await prisma.openingInventoryValuation.deleteMany({ where: { id: valuation.id } });
    await prisma.lotCityGodownAllocation.deleteMany({ where: { id: allocation.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.godown.deleteMany({ where: { id: godown.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    void pkr;
  }
});

test("H3: city PATCH cannot attach a non-wired foreign currency to a Pakistan city", async () => {
  const { quetta, pkr, usd, superToken } = await seedBase();
  const before = await prisma.cityCurrency.findMany({ where: { cityId: quetta.id }, orderBy: { currencyId: "asc" } });
  try {
    const res = await updateCity(
      new NextRequest(`http://localhost/api/v1/cities/${quetta.id}`, {
        method: "PATCH",
        headers: authHeaders(superToken),
        body: JSON.stringify({ currencyIds: [pkr.id, usd.id] }),
      }),
      { params: { id: String(quetta.id) } }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 409, `USD must not attach to a Pakistan city: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "FOREIGN_CARRYING_LAYER_REQUIRED");
    const after = await prisma.cityCurrency.findMany({ where: { cityId: quetta.id }, orderBy: { currencyId: "asc" } });
    assert.deepEqual(after.map((r) => r.currencyId), before.map((r) => r.currencyId), "attachments must be unchanged");
  } finally {
    const allowed = before.map((r) => r.currencyId);
    await prisma.cityCurrency.deleteMany({ where: { cityId: quetta.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "cities", entityId: quetta.id } });
    if (allowed.length) {
      await prisma.cityCurrency.createMany({ data: allowed.map((currencyId) => ({ cityId: quetta.id, currencyId })) });
    }
  }
});

test("H3: city PATCH keeps Afghanistan cities allowed to hold wired foreign currencies", async () => {
  const { kandahar, pkr, usd, afn, superToken } = await seedBase();
  const before = await prisma.cityCurrency.findMany({ where: { cityId: kandahar.id }, orderBy: { currencyId: "asc" } });
  try {
    const res = await updateCity(
      new NextRequest(`http://localhost/api/v1/cities/${kandahar.id}`, {
        method: "PATCH",
        headers: authHeaders(superToken),
        body: JSON.stringify({ currencyIds: [afn.id, usd.id] }),
      }),
      { params: { id: String(kandahar.id) } }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 200, `AFN+USD must stay attachable to an Afghanistan city: ${JSON.stringify(json)}`);
    const codes = await prisma.cityCurrency.findMany({ where: { cityId: kandahar.id }, include: { currency: true } });
    assert.ok(codes.some((r) => r.currency.code === "AFN"));
    assert.ok(codes.some((r) => r.currency.code === "USD"));
  } finally {
    const allowed = before.map((r) => r.currencyId);
    await prisma.cityCurrency.deleteMany({ where: { cityId: kandahar.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "cities", entityId: kandahar.id } });
    if (allowed.length) {
      await prisma.cityCurrency.createMany({ data: allowed.map((currencyId) => ({ cityId: kandahar.id, currencyId })) });
    }
    void pkr;
  }
});
