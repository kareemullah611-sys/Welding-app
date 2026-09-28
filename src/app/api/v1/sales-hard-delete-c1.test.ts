import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken, hashPassword } from "@/lib/auth";
import { getCustomerAccountId, getSalesRevenueAccountId, getCOGSAccountId, journalSaleDiscount } from "@/lib/accounting";
import { DELETE as hardDeleteSale } from "@/app/api/v1/sales/[id]/hard-delete/route";

const PASSWORD = "C1-HardDelete-Test-1!";
const marker = `c1hd${Date.now()}`;
const voucherNo = `C1${String(Date.now() % 1e8).padStart(8, "0")}`;

async function seedBase() {
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");
  const admin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(admin, "Seed user superadmin is required for this test");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required for this test");
  return { city, admin, pkr };
}

async function seedSale(opts: { cityId: number; adminId: number; countryId: number; pkrId: number; status: "active" | "cancelled" }) {
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const customer = await prisma.customer.create({ data: { cityId: opts.cityId, name: `${marker}-customer`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: opts.cityId, name: `${marker}-godown` } });
  const lot = await prisma.lot.create({
    data: {
      countryId: opts.countryId,
      lotNumber: `${marker}-lot`,
      lotDate: new Date("2026-04-01"),
      createdBy: opts.adminId,
    },
  });
  const sale = await prisma.sale.create({
    data: {
      cityId: opts.cityId,
      customerId: customer.id,
      lotId: lot.id,
      godownId: godown.id,
      voucherNo,
      saleDate: new Date("2026-04-15"),
      totalAmount: 1000,
      currencyId: opts.pkrId,
      status: opts.status,
      createdBy: opts.adminId,
    },
  });
  return { product, customer, godown, lot, sale };
}

async function cleanupSaleRows(ids: { saleId: number; lotId: number; godownId: number; customerId: number; productId: number; cityId: number }) {
  // Guard: an undefined id would be stripped by Prisma and turn deleteMany({where:{id}}) into a wipe.
  for (const [key, value] of Object.entries(ids)) assert.ok(Number.isInteger(value), `cleanup id ${key} must be an integer, got ${value}`);
  await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`SALE-${ids.saleId}`, `COGS-${ids.saleId}`, `REV-SALE-${ids.saleId}`, `REV-COGS-${ids.saleId}`] } } });
  await prisma.saleDiscount.deleteMany({ where: { saleId: ids.saleId } });
  await prisma.saleItem.deleteMany({ where: { saleId: ids.saleId } });
  await prisma.sale.deleteMany({ where: { id: ids.saleId } });
  await prisma.lot.deleteMany({ where: { id: ids.lotId } });
  await prisma.godown.deleteMany({ where: { id: ids.godownId } });
  await prisma.customer.deleteMany({ where: { id: ids.customerId } });
  await prisma.product.deleteMany({ where: { id: ids.productId } });
}

test("C1 E2E: hard-delete rejects cancelled sales and purges discount journals with the sale", async (t) => {
  const { city, admin, pkr } = await seedBase();
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "super_admin",
    cityId: null,
    countryId: null, // must match getDatabaseUserForToken: superadmin has no city → countryId null
  });
  // Temporarily set the 2FA password the route verifies against; restored even on failure.
  const originalPasswordHash = admin.passwordHash;
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  t.after(async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: originalPasswordHash } });
  });

  // --- Part A: cancelled sale must be blocked (status guard) ---
  const cancelled = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "cancelled" });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `SALE-${cancelled.sale.id}`, lineNumber: 1, accountId: await getSalesRevenueAccountId(), debit: 0, credit: 1000, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `SALE-${cancelled.sale.id}`, lineNumber: 2, accountId: await getCustomerAccountId(cancelled.customer.id), debit: 1000, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
      ],
    });

    const blockedRequest = new NextRequest(`http://localhost/api/v1/sales/${cancelled.sale.id}/hard-delete`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const blockedResponse = await hardDeleteSale(blockedRequest, { params: { id: String(cancelled.sale.id) } });
    const blockedJson = (await blockedResponse.json()) as any;

    assert.equal(blockedResponse.status, 409, `expected 409 for cancelled sale, got ${blockedResponse.status}: ${JSON.stringify(blockedJson)}`);
    assert.equal(blockedJson.error?.code, "CONFLICT");
    assert.ok(await prisma.sale.findUnique({ where: { id: cancelled.sale.id } }), "cancelled sale must survive the blocked delete");
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `SALE-${cancelled.sale.id}` } }),
      2,
      "reversal-bearing sale journals must survive the blocked delete"
    );
  } finally {
    await cleanupSaleRows({ saleId: cancelled.sale.id, lotId: cancelled.lot.id, godownId: cancelled.godown.id, customerId: cancelled.customer.id, productId: cancelled.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: `1200-C${cancelled.customer.id}` } });
  }

  // --- Part B: active sale with discount purges SALE/COGS/DISCOUNT journals together ---
  const active = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "active" });
  let discountId = 0;
  try {
    const revenueId = await getSalesRevenueAccountId();
    const customerAccountId = await getCustomerAccountId(active.customer.id);
    const cogsId = await getCOGSAccountId();
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `SALE-${active.sale.id}`, lineNumber: 1, accountId: customerAccountId, debit: 1000, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `SALE-${active.sale.id}`, lineNumber: 2, accountId: revenueId, debit: 0, credit: 1000, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `COGS-${active.sale.id}`, lineNumber: 1, accountId: cogsId, debit: 600, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `COGS-${active.sale.id}`, lineNumber: 2, accountId: cogsId, debit: 0, credit: 600, currencyCode: "PKR", description: "C1 seed — inventory side omitted for delete-path isolation", entryDate: new Date("2026-04-15"), createdBy: admin.id },
      ],
    });
    const discount = await prisma.saleDiscount.create({
      data: {
        saleId: active.sale.id,
        discountAmount: 100,
        currencyId: pkr.id,
        appliedToLotId: active.lot.id,
        discountDate: new Date("2026-04-16"),
        createdBy: admin.id,
      },
    });
    discountId = discount.id;
    await journalSaleDiscount({
      id: discount.id,
      saleId: active.sale.id,
      customerId: active.customer.id,
      cityId: city.id,
      lotId: active.lot.id,
      amount: 100,
      currencyCode: "PKR",
      discountDate: new Date("2026-04-16"),
      createdBy: admin.id,
    });

    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `DISCOUNT-${discount.id}` } }), 2, "seed precondition: discount journal exists");

    const request = new NextRequest(`http://localhost/api/v1/sales/${active.sale.id}/hard-delete`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const response = await hardDeleteSale(request, { params: { id: String(active.sale.id) } });
    const json = (await response.json()) as any;

    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);

    assert.equal(await prisma.sale.findUnique({ where: { id: active.sale.id } }), null, "sale row must be deleted");
    assert.equal(await prisma.saleDiscount.count({ where: { saleId: active.sale.id } }), 0, "discount rows must be deleted");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `SALE-${active.sale.id}` } }), 0, "SALE journal must be deleted");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `COGS-${active.sale.id}` } }), 0, "COGS journal must be deleted");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `DISCOUNT-${discountId}` } }), 0, "DISCOUNT journal must be deleted — no orphaned AR credit");
    assert.equal(await prisma.auditLog.count({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } }), 1, "audit row must exist");
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: `DISCOUNT-${discountId}` } });
    await cleanupSaleRows({ saleId: active.sale.id, lotId: active.lot.id, godownId: active.godown.id, customerId: active.customer.id, productId: active.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: `1200-C${active.customer.id}` } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } });
  }
});
