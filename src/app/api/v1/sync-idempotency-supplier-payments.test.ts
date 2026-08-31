import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createSupplierPayment } from "@/app/api/v1/supplier-payments/route";

test("supplier payment create is idempotent for repeated sync request id", async () => {
  const marker = `sync-supplier-payment-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const supplier = await prisma.supplier.create({
    data: { name: marker, country: "China", contact: "sync-test", notes: "sync test" },
  });
  const intermediary = await prisma.intermediary.create({
    data: { name: `${marker}-int`, notes: "sync test" },
  });
  const [country, city, usd, product] = await Promise.all([
    prisma.country.findUnique({ where: { code: "PK" } }),
    prisma.city.findFirst({ where: { country: { code: "PK" } } }),
    prisma.currency.findUnique({ where: { code: "USD" } }),
    prisma.product.findFirst({ where: { isActive: true } }),
  ]);
  assert.ok(country && city && usd && product, "Pakistan, USD, city, and an active product are required");
  const lot = await prisma.lot.create({
    data: {
      countryId: country.id,
      lotNumber: `${marker}-lot`,
      lotDate: new Date("2026-04-20"),
      pkrExchangeRate: 280,
      status: "ongoing",
      createdBy: superAdmin.id,
    },
  });
  const purchase = await prisma.lotPurchase.create({
    data: {
      lotId: lot.id,
      supplierId: supplier.id,
      productId: product.id,
      qty: 2,
      unitPriceUsd: 1000,
      totalPriceUsd: 2000,
      carryingRatePkr: 280,
      carryingAmountPkr: 560000,
      recognitionDate: new Date("2026-04-20"),
      createdBy: superAdmin.id,
    },
  });
  const deposit = await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId: intermediary.id,
      depositDate: new Date("2026-04-21"),
      amount: 2000,
      currencyId: usd.id,
      sourceType: "city_cash",
      cityId: city.id,
      createdBy: superAdmin.id,
    },
  });
  const layer = await prisma.intermediaryUsdCostLayer.create({
    data: {
      intermediaryId: intermediary.id,
      currencyId: usd.id,
      sourceType: "sync_test_supplier",
      sourceId: deposit.id,
      acquiredDate: new Date("2026-04-21"),
      originalAmountUsd: 2000,
      remainingAmountUsd: 2000,
      originalCostPkr: 564000,
      remainingCostPkr: 564000,
      ratePkr: 282,
    },
  });

  const syncRequestId = `req-supplier-payment-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    supplierId: supplier.id,
    lotId: lot.id,
    paymentDate: "2026-04-27",
    amountUsd: 1234,
    paymentMethod: "other",
    reference: "sync-test",
    notes: "offline replay test",
    intermediaryId: intermediary.id,
    exchangeRate: 282,
  };
  let createdPaymentId: number | null = null;

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/supplier-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createSupplierPayment(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");
    createdPaymentId = firstId;

    const secondRequest = new NextRequest("http://localhost/api/v1/supplier-payments", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createSupplierPayment(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same supplier payment");

    const createdRows = await prisma.supplierPayment.findMany({
      where: {
        supplierId: supplier.id,
        reference: "sync-test",
      },
    });
    assert.equal(createdRows.length, 1, "Only one supplier payment row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "supplier_payments",
        requestId: syncRequestId,
      },
    });
    if (createdPaymentId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "supplier_payments", entityId: createdPaymentId } });
      await prisma.journalEntry.deleteMany({ where: { entityType: "supplier_payment", entityId: createdPaymentId } });
    }
    await prisma.supplierPayment.deleteMany({ where: { supplierId: supplier.id, reference: "sync-test" } });
    await prisma.intermediaryUsdCostLayer.deleteMany({ where: { id: layer.id } });
    await prisma.intermediaryDeposit.deleteMany({ where: { id: deposit.id } });
    await prisma.lotPurchase.deleteMany({ where: { id: purchase.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
    await prisma.supplier.deleteMany({ where: { id: supplier.id } });
  }
});
