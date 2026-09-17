import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { PUT as updateLotPurchase } from "@/app/api/v1/lot-purchases/[id]/route";

test("post-sale purchase edit posts a current delta without reversing the original purchase journal", async () => {
  const marker = `purchase-correction-${Date.now()}`;
  const [superAdmin, city, currency] = await Promise.all([
    prisma.user.findUnique({ where: { username: "superadmin" } }),
    prisma.city.findFirst({ include: { godowns: true } }),
    prisma.currency.findFirst({ where: { code: "PKR" } }),
  ]);
  assert.ok(superAdmin && city?.godowns[0] && currency, "Seed superadmin, city/godown, and PKR currency are required");

  const token = generateToken({ userId: superAdmin.id, username: superAdmin.username, role: "super_admin", cityId: null, countryId: null });
  const customer = await prisma.customer.create({ data: { cityId: city.id, name: marker } });
  const product = await prisma.product.create({ data: { name: `${marker}-product`, unitOfMeasure: "MT", defaultWeightPerCartonKg: 25 } });
  const supplier = await prisma.supplier.create({ data: { name: `${marker}-supplier`, country: "Pakistan" } });
  const lot = await prisma.lot.create({ data: { countryId: city.countryId, lotNumber: marker, lotDate: new Date("2026-09-01"), pkrExchangeRate: 1, createdBy: superAdmin.id } });
  await prisma.lotProduct.create({ data: { lotId: lot.id, productId: product.id, totalQty: 100 } });
  const purchase = await prisma.lotPurchase.create({
    data: {
      lotId: lot.id, supplierId: supplier.id, productId: product.id, qty: 2.5, weightPerCartonKg: 25,
      unitPriceUsd: 1_000, totalPriceUsd: 2_500, carryingRatePkr: 1, carryingAmountPkr: 2_500,
      recognitionDate: lot.lotDate, createdBy: superAdmin.id,
    },
  });
  const sale = await prisma.sale.create({
    data: {
      cityId: city.id, customerId: customer.id, lotId: lot.id, godownId: city.godowns[0].id,
      voucherNo: String(Date.now()).slice(-10), saleDate: new Date("2026-09-05"), totalAmount: 6_000,
      currencyId: currency.id, createdBy: superAdmin.id,
      items: { create: { lotId: lot.id, productId: product.id, qty: 60, ratePerCarton: 100, amount: 6_000 } },
    },
  });

  try {
    const request = new NextRequest(`http://localhost/api/v1/lot-purchases/${purchase.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ qtyMt: 2.5, unitPriceUsdPerMt: 1_200, weightPerCartonKg: 25 }),
    });
    const response = await updateLotPurchase(request, { params: { id: String(purchase.id) } });
    const json = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(json));

    const correctionRows = await prisma.journalEntry.findMany({
      where: { entityType: "lot_purchase_correction", entityId: lot.id },
      include: { account: true },
    });
    const byCode = new Map(correctionRows.map((row) => [row.account.code, { debit: Number(row.debit), credit: Number(row.credit) }]));
    assert.deepEqual(byCode.get("4001"), { debit: 300, credit: 0 });
    assert.deepEqual(byCode.get("1100"), { debit: 200, credit: 0 });
    assert.deepEqual(byCode.get(`2100-S${supplier.id}`), { debit: 0, credit: 500 });
    assert.equal(correctionRows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0), 0);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: { startsWith: `REV-PURCH-${lot.id}-${purchase.id}` } } }), 0);
  } finally {
    await prisma.journalEntry.deleteMany({ where: { entityType: "lot_purchase_correction", entityId: lot.id } });
    await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
    await prisma.sale.delete({ where: { id: sale.id } });
    await prisma.lotPurchase.deleteMany({ where: { lotId: lot.id } });
    await prisma.lotProduct.deleteMany({ where: { lotId: lot.id } });
    await prisma.lot.delete({ where: { id: lot.id } });
    await prisma.supplier.delete({ where: { id: supplier.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }
});
