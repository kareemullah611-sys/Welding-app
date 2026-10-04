import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createSale } from "@/app/api/v1/sales/route";
import { POST as applyDiscount } from "@/app/api/v1/sales/[id]/discount/route";
import { PUT as correctSale } from "@/app/api/v1/sales/[id]/correct/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

interface Seed {
  cityId: number; countryId: number; adminId: number; pkrId: number; token: string;
  productId: number; lotId: number; godownId: number;
}

async function seed(marker: string): Promise<Seed> {
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(admin, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-godown`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: admin.id },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 1000 },
  });
  await prisma.lotCityGodownAllocation.create({
    data: { lotCityDistributionId: distribution.id, godownId: godown.id, productId: product.id, qty: 1000 },
  });
  await prisma.openingInventoryValuation.create({
    data: { lotId: lot.id, productId: product.id, quantity: 1000, unitCostPkr: 50, totalValuePkr: 50000, openingDate: new Date("2026-04-01"), createdBy: admin.id },
  });
  return {
    cityId: city.id, countryId: city.countryId, adminId: admin.id, pkrId: pkr.id,
    token: generateToken({ userId: admin.id, username: admin.username, role: "city_admin", cityId: city.id, countryId: city.countryId }),
    productId: product.id, lotId: lot.id, godownId: godown.id,
  };
}

async function teardown(s: Seed) {
  await prisma.openingInventoryValuation.deleteMany({ where: { lotId: s.lotId, productId: s.productId } });
  const dist = await prisma.lotCityDistribution.findFirst({ where: { lotId: s.lotId, cityId: s.cityId, productId: s.productId } });
  if (dist) {
    await prisma.lotCityGodownAllocation.deleteMany({ where: { lotCityDistributionId: dist.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: dist.id } });
  }
  await prisma.lot.deleteMany({ where: { id: s.lotId } });
  await prisma.godown.deleteMany({ where: { id: s.godownId } });
  await prisma.product.deleteMany({ where: { id: s.productId } });
}

async function postWalkInSale(s: Seed, marker: string, extra: Record<string, unknown> = {}) {
  const res = await createSale(
    new NextRequest("http://localhost/api/v1/sales", {
      method: "POST",
      headers: authHeaders(s.token),
      body: JSON.stringify({
        customerId: -1,
        godownId: s.godownId,
        saleDate: "2026-04-24",
        currencyId: s.pkrId,
        notes: marker,
        items: [{ productId: s.productId, lotId: s.lotId, qty: 5, ratePerCarton: 100 }],
        ...extra,
      }),
    }),
    { params: {} }
  );
  const json = (await res.json()) as any;
  const sale = await prisma.sale.findFirst({ where: { notes: marker }, orderBy: { id: "desc" } });
  return { status: res.status, json, sale };
}

async function cleanupSale(s: Seed, saleId: number | null) {
  if (!saleId) return;
  const discounts = await prisma.saleDiscount.findMany({ where: { saleId }, select: { id: true } });
  const payments = await prisma.payment.findMany({ where: { saleId }, select: { id: true } });
  const pids = payments.map((p) => p.id);
  const txnIds = [
    `SALE-${saleId}`, `REV-SALE-${saleId}`, `COGS-${saleId}`, `REV-COGS-${saleId}`,
    ...discounts.map((d) => `DISCOUNT-${d.id}`),
    ...pids.map((p) => `PAY-${p}`),
  ];
  if (pids.length) {
    const adj = await prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: `ADJPAY-${pids[0]}-` } },
      select: { transactionId: true },
      distinct: ["transactionId"],
    });
    txnIds.push(...adj.map((a) => a.transactionId));
  }
  await prisma.journalEntry.deleteMany({ where: { transactionId: { in: txnIds } } });
  await prisma.journalEntry.deleteMany({
    where: {
      OR: [
        { transactionId: { startsWith: `SALE-${saleId}-V` } },
        { transactionId: { startsWith: `REV-SALE-${saleId}` } },
        { transactionId: { startsWith: `COGS-${saleId}-V` } },
        { transactionId: { startsWith: `REV-COGS-${saleId}` } },
      ],
    },
  });
  await prisma.saleDiscount.deleteMany({ where: { saleId } });
  const walkin = await prisma.sale.findFirst({ where: { id: saleId }, select: { customerId: true } });
  if (walkin) {
    await prisma.auditLog.deleteMany({ where: { entityType: "payments", entityId: { in: pids } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: saleId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sale_discounts", entityId: { in: discounts.map((d) => d.id) } } });
  }
  await prisma.payment.deleteMany({ where: { saleId } });
  await prisma.saleItem.deleteMany({ where: { saleId } });
  await prisma.sale.deleteMany({ where: { id: saleId } });
}

test("M2: walk-in sale credit mode creates no auto payment", async () => {
  const marker = `m2-credit-${Date.now()}`;
  const s = await seed(marker);
  let saleId: number | null = null;
  try {
    const { status, sale } = await postWalkInSale(s, marker, { walkInPaymentMode: "credit" });
    assert.equal(status, 201, `credit-mode sale must be created`);
    assert.ok(sale, "sale row must exist");
    saleId = sale.id;
    const payCount = await prisma.payment.count({ where: { saleId: sale.id } });
    assert.equal(payCount, 0, "credit mode must not create an auto payment");
  } finally {
    await cleanupSale(s, saleId);
    await teardown(s);
  }
});

test("M2: discount and correction keep a paid walk-in payment in sync (AR nets to zero)", async () => {
  const marker = `m2-paid-${Date.now()}`;
  const s = await seed(marker);
  let saleId: number | null = null;
  try {
    const created = await postWalkInSale(s, marker);
    assert.equal(created.status, 201, `paid walk-in sale must be created: ${JSON.stringify(created.json)}`);
    assert.ok(created.sale, "sale row must exist");
    saleId = created.sale.id;
    assert.equal(Number(created.sale.totalAmount), 500, "seed precondition: sale total 500");

    const payment = await prisma.payment.findFirst({ where: { saleId } });
    assert.ok(payment, "paid mode must create the auto payment");
    assert.equal(Number(payment.amount), 500, "auto payment starts at sale total");

    const discountRes = await applyDiscount(
      new NextRequest(`http://localhost/api/v1/sales/${saleId}/discount`, {
        method: "POST",
        headers: authHeaders(s.token),
        body: JSON.stringify({ discountAmount: 50, notes: `${marker}-disc`, discountDate: "2026-04-25" }),
      }),
      { params: { id: String(saleId) } }
    );
    assert.equal(discountRes.status, 200, "discount must apply");
    const afterDiscount = await prisma.payment.findFirst({ where: { saleId } });
    assert.equal(Number(afterDiscount!.amount), 450, "payment amount must follow the discount (450)");
    const adjRows = await prisma.journalEntry.count({
      where: { transactionId: { startsWith: `ADJPAY-${payment.id}-` } },
    });
    assert.equal(adjRows, 2, "discount must post an ADJPAY delta journal pair");

    const disc = await prisma.saleDiscount.findFirst({ where: { saleId } });
    assert.ok(disc, "discount row must exist");

    const correctRes = await correctSale(
      new NextRequest(`http://localhost/api/v1/sales/${saleId}/correct`, {
        method: "PUT",
        headers: authHeaders(s.token),
        body: JSON.stringify({
          saleDate: "2026-04-24",
          godownId: s.godownId,
          reason: `${marker}-correct`,
          items: [{ productId: s.productId, lotId: s.lotId, qty: 3, ratePerCarton: 100 }],
        }),
      }),
      { params: { id: String(saleId) } }
    );
    const correctJson = (await correctRes.json()) as any;
    assert.equal(correctRes.status, 200, `correction must apply: ${JSON.stringify(correctJson)}`);

    const corrected = await prisma.sale.findUnique({ where: { id: saleId } });
    assert.equal(Number(corrected!.totalAmount), 250, "L5: corrected total must be net of discounts (300 - 50)");
    const afterCorrect = await prisma.payment.findFirst({ where: { saleId } });
    assert.equal(Number(afterCorrect!.amount), 250, "payment amount must follow the correction (250)");

    const walkin = await prisma.sale.findUnique({ where: { id: saleId }, select: { customerId: true } });
    const arAccount = await prisma.account.findFirst({ where: { code: `1200-C${walkin!.customerId}` } });
    assert.ok(arAccount, "walk-in AR account must exist");
    const adj = await prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: `ADJPAY-${payment.id}-` } },
      select: { transactionId: true },
      distinct: ["transactionId"],
    });
    const rows = await prisma.journalEntry.findMany({
      where: {
        accountId: arAccount.id,
        OR: [
          { transactionId: { startsWith: `SALE-${saleId}` } },
          { transactionId: { startsWith: `REV-SALE-${saleId}` } },
          { transactionId: { in: [`DISCOUNT-${disc.id}`, `PAY-${payment.id}`, ...adj.map((a) => a.transactionId)] } },
        ],
      },
      select: { debit: true, credit: true },
    });
    const net = rows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0);
    assert.ok(Math.abs(net) < 0.01, `walk-in AR must net to zero after discount+correction, got ${net}`);
  } finally {
    if (saleId) await cleanupSale(s, saleId);
    await teardown(s);
  }
});

test("L5: correction cannot drive the sale total below applied discounts", async () => {
  const marker = `m2-guard-${Date.now()}`;
  const s = await seed(marker);
  let saleId: number | null = null;
  try {
    const created = await postWalkInSale(s, marker);
    assert.equal(created.status, 201, "seed sale must be created");
    saleId = created.sale!.id;
    const discountRes = await applyDiscount(
      new NextRequest(`http://localhost/api/v1/sales/${saleId}/discount`, {
        method: "POST",
        headers: authHeaders(s.token),
        body: JSON.stringify({ discountAmount: 450, notes: `${marker}-disc`, discountDate: "2026-04-25" }),
      }),
      { params: { id: String(saleId) } }
    );
    assert.equal(discountRes.status, 200, "discount 450 must apply on 500 sale");

    const correctRes = await correctSale(
      new NextRequest(`http://localhost/api/v1/sales/${saleId}/correct`, {
        method: "PUT",
        headers: authHeaders(s.token),
        body: JSON.stringify({
          saleDate: "2026-04-24",
          godownId: s.godownId,
          reason: `${marker}-undercut`,
          items: [{ productId: s.productId, lotId: s.lotId, qty: 1, ratePerCarton: 100 }],
        }),
      }),
      { params: { id: String(saleId) } }
    );
    const json = (await correctRes.json()) as any;
    assert.equal(correctRes.status, 409, `correction below discounts must be rejected: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "DISCOUNT_EXCEEDS_ITEMS");
  } finally {
    if (saleId) await cleanupSale(s, saleId);
    await teardown(s);
  }
});
