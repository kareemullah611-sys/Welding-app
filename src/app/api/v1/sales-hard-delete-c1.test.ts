import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken, hashPassword } from "@/lib/auth";
import { getCustomerAccountId, getSalesRevenueAccountId, getCOGSAccountId, journalSaleDiscount } from "@/lib/accounting";
import { DELETE as hardDeleteSale } from "@/app/api/v1/sales/[id]/hard-delete/route";
import { GET as listSales } from "@/app/api/v1/sales/route";

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

let seedSaleSeq = 0;
async function seedSale(opts: { cityId: number; adminId: number; countryId: number; pkrId: number; status: "active" | "cancelled" }) {
  const seq = ++seedSaleSeq;
  const product = await prisma.product.create({ data: { name: `${marker}-product${seq}`, isActive: true } });
  const customer = await prisma.customer.create({ data: { cityId: opts.cityId, name: `${marker}-customer${seq}`, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: opts.cityId, name: `${marker}-godown${seq}` } });
  const lot = await prisma.lot.create({
    data: {
      countryId: opts.countryId,
      lotNumber: `${marker}-lot${seq}`,
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
      voucherNo: `${voucherNo.slice(0, 9)}${seq % 10}`,
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

  // --- Part B: active sale WITH accounting history must be refused (409), records intact ---
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

    assert.equal(response.status, 409, `expected 409 for a sale with accounting history, got ${response.status}: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "SALE_HAS_ACCOUNTING_HISTORY");
    assert.ok(await prisma.sale.findUnique({ where: { id: active.sale.id } }), "sale must survive the refused delete");
    assert.notEqual(await prisma.saleDiscount.findUnique({ where: { id: discountId } }), null, "discount row must survive the refused delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `SALE-${active.sale.id}` } }), 2, "SALE journals must survive — immutable accounting history");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `COGS-${active.sale.id}` } }), 2, "COGS journals must survive — immutable accounting history");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `DISCOUNT-${discountId}` } }), 2, "DISCOUNT journals must survive — immutable accounting history");
    assert.equal(
      await prisma.auditLog.count({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } }),
      0,
      "no hard_delete audit row may be written for a refused delete"
    );
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`SALE-${active.sale.id}`, `COGS-${active.sale.id}`, `DISCOUNT-${discountId}`] } } });
    await prisma.saleDiscount.deleteMany({ where: { saleId: active.sale.id } });
    await cleanupSaleRows({ saleId: active.sale.id, lotId: active.lot.id, godownId: active.godown.id, customerId: active.customer.id, productId: active.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: `1200-C${active.customer.id}` } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } });
  }
});

test("C1 E2E: hard-delete is blocked when the walk-in auto-payment was cancelled (reversal history kept)", async (t) => {
  const { city, admin, pkr } = await seedBase();
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
  const originalPasswordHash = admin.passwordHash;
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  t.after(async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: originalPasswordHash } });
  });

  const active = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "active" });
  // The route identifies walk-in sales by customer name; seedSale creates a unique one.
  await prisma.customer.update({ where: { id: active.customer.id }, data: { name: "Walk-in Customer" } });
  let paymentId = 0;
  try {
    const payment = await prisma.payment.create({
      data: {
        cityId: city.id,
        customerId: active.customer.id,
        paymentDate: new Date("2026-04-15"),
        detail: `${marker}-walkin-payment`,
        amount: 1000,
        currencyId: pkr.id,
        paymentMethod: "cash",
        destination: "our_account",
        status: "cancelled",
        cancellationReason: "C1 seed",
        cancelledAt: new Date("2026-04-16"),
        cancelledBy: admin.id,
        saleId: active.sale.id,
        createdBy: admin.id,
      },
    });
    paymentId = payment.id;
    const customerAccountId = await getCustomerAccountId(active.customer.id);
    const revenueAccountId = await getSalesRevenueAccountId();
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `PAY-${paymentId}`, lineNumber: 1, accountId: revenueAccountId, debit: 0, credit: 1000, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `PAY-${paymentId}`, lineNumber: 2, accountId: customerAccountId, debit: 1000, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `REV-PAY-${paymentId}`, lineNumber: 1, accountId: customerAccountId, debit: 0, credit: 1000, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-16"), createdBy: admin.id },
        { transactionId: `REV-PAY-${paymentId}`, lineNumber: 2, accountId: revenueAccountId, debit: 1000, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-16"), createdBy: admin.id },
      ],
    });
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }), 2, "seed precondition: reversal rows exist");

    const request = new NextRequest(`http://localhost/api/v1/sales/${active.sale.id}/hard-delete`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const response = await hardDeleteSale(request, { params: { id: String(active.sale.id) } });
    const json = (await response.json()) as any;

    assert.equal(response.status, 409, `expected 409, got ${response.status}: ${JSON.stringify(json)}`);
    assert.equal(json.error?.code, "CONFLICT");
    assert.ok(await prisma.sale.findUnique({ where: { id: active.sale.id } }), "sale must survive the blocked delete");
    assert.notEqual(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "cancelled walk-in payment must survive the blocked delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "PAY rows must survive the blocked delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }), 2, "reversal rows must survive — immutable audit history");
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`PAY-${paymentId}`, `REV-PAY-${paymentId}`] } } });
    await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } });
    await cleanupSaleRows({ saleId: active.sale.id, lotId: active.lot.id, godownId: active.godown.id, customerId: active.customer.id, productId: active.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: `1200-C${active.customer.id}` } });
  }
});

test("C1 E2E: hard-delete still removes a journal-less sale and its journal-less walk-in payment", async (t) => {
  const { city, admin, pkr } = await seedBase();
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
  const originalPasswordHash = admin.passwordHash;
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  t.after(async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: originalPasswordHash } });
  });

  const active = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "active" });
  await prisma.customer.update({ where: { id: active.customer.id }, data: { name: "Walk-in Customer" } });
  let paymentId = 0;
  try {
    const payment = await prisma.payment.create({
      data: {
        cityId: city.id,
        customerId: active.customer.id,
        paymentDate: new Date("2026-04-15"),
        detail: `${marker}-walkin-journalless`,
        amount: 1000,
        currencyId: pkr.id,
        paymentMethod: "cash",
        destination: "our_account",
        saleId: active.sale.id,
        createdBy: admin.id,
      },
    });
    paymentId = payment.id;

    const request = new NextRequest(`http://localhost/api/v1/sales/${active.sale.id}/hard-delete`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const response = await hardDeleteSale(request, { params: { id: String(active.sale.id) } });
    const json = (await response.json()) as any;

    assert.equal(response.status, 200, `expected 200 for a journal-less sale, got ${response.status}: ${JSON.stringify(json)}`);
    assert.equal(await prisma.sale.findUnique({ where: { id: active.sale.id } }), null, "journal-less sale row must be deleted");
    assert.equal(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "journal-less walk-in payment row must be deleted with the sale");
    assert.equal(
      await prisma.auditLog.count({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } }),
      1,
      "audit row must exist for an allowed delete"
    );
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`PAY-${paymentId}`, `REV-PAY-${paymentId}`] } } });
    await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "sales", entityId: active.sale.id, action: "hard_delete" } });
    await cleanupSaleRows({ saleId: active.sale.id, lotId: active.lot.id, godownId: active.godown.id, customerId: active.customer.id, productId: active.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: `1200-C${active.customer.id}` } });
  }
});

test("C1: sales list exposes hasAccountingHistory so the UI can hide permanent deletion", async () => {
  const { city, admin, pkr } = await seedBase();
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
  const posted = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "active" });
  const plain = await seedSale({ cityId: city.id, adminId: admin.id, countryId: city.countryId, pkrId: pkr.id, status: "active" });
  try {
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `SALE-${posted.sale.id}`, lineNumber: 1, accountId: await getCustomerAccountId(posted.customer.id), debit: 1000, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `SALE-${posted.sale.id}`, lineNumber: 2, accountId: await getSalesRevenueAccountId(), debit: 0, credit: 1000, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `COGS-${posted.sale.id}`, lineNumber: 1, accountId: await getCOGSAccountId(), debit: 600, credit: 0, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
        { transactionId: `COGS-${posted.sale.id}`, lineNumber: 2, accountId: await getCOGSAccountId(), debit: 0, credit: 600, currencyCode: "PKR", description: "C1 seed", entryDate: new Date("2026-04-15"), createdBy: admin.id },
      ],
    });

    const postedRes = await listSales(
      new NextRequest(`http://localhost/api/v1/sales?customer_id=${posted.customer.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: {} }
    );
    const postedJson = (await postedRes.json()) as any;
    assert.equal(postedRes.status, 200, `list failed: ${JSON.stringify(postedJson)}`);
    const postedRow = postedJson.data.find((s: any) => s.id === posted.sale.id);
    assert.ok(postedRow, "posted sale must be present in the list");
    assert.equal(postedRow.hasAccountingHistory, true, "sale with SALE/COGS journals must expose hasAccountingHistory=true");

    const plainRes = await listSales(
      new NextRequest(`http://localhost/api/v1/sales?customer_id=${plain.customer.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: {} }
    );
    const plainJson = (await plainRes.json()) as any;
    assert.equal(plainRes.status, 200, `list failed: ${JSON.stringify(plainJson)}`);
    const plainRow = plainJson.data.find((s: any) => s.id === plain.sale.id);
    assert.ok(plainRow, "journal-less sale must be present in the list");
    assert.equal(plainRow.hasAccountingHistory, false, "journal-less sale must expose hasAccountingHistory=false");
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`SALE-${posted.sale.id}`, `COGS-${posted.sale.id}`] } } });
    await cleanupSaleRows({ saleId: posted.sale.id, lotId: posted.lot.id, godownId: posted.godown.id, customerId: posted.customer.id, productId: posted.product.id, cityId: city.id });
    await cleanupSaleRows({ saleId: plain.sale.id, lotId: plain.lot.id, godownId: plain.godown.id, customerId: plain.customer.id, productId: plain.product.id, cityId: city.id });
    await prisma.account.deleteMany({ where: { code: { in: [`1200-C${posted.customer.id}`, `1200-C${plain.customer.id}`] } } });
  }
});
