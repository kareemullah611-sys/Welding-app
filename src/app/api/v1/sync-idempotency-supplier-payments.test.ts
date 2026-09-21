import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createSupplierPayment } from "@/app/api/v1/supplier-payments/route";
import { DELETE as deleteSupplierPayment, PUT as updateSupplierPayment } from "@/app/api/v1/supplier-payments/[id]/route";
import { foreignCurrencyOwnerKey, recordForeignCurrencyRecognition } from "@/lib/foreign-currency-carrying-db";

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
      amount: 3000,
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
      originalAmountUsd: 3000,
      remainingAmountUsd: 3000,
      originalCostPkr: 846000,
      remainingCostPkr: 846000,
      ratePkr: 282,
    },
  });
  const carryingLayer = await prisma.$transaction((tx) => recordForeignCurrencyRecognition(tx, {
    positionKind: "asset",
    positionType: "intermediary_balance",
    ownerKey: foreignCurrencyOwnerKey.intermediary(intermediary.id),
    currencyCode: "USD",
    sourceType: "test_supplier_payment_funding",
    sourceId: deposit.id,
    recognitionDate: new Date("2026-04-21"),
    historicalPoolDate: new Date("2026-04-21"),
    foreignAmount: 3000,
    carryingAmountPkr: 846000,
    rate: { ratePkr: 282, rateType: "test", provider: "LOCAL_TEST" },
    createdBy: superAdmin.id,
  }));
  const payableLayer = await prisma.$transaction((tx) => recordForeignCurrencyRecognition(tx, {
    positionKind: "liability",
    positionType: "supplier_payable",
    ownerKey: foreignCurrencyOwnerKey.supplierPayable(supplier.id, lot.id),
    currencyCode: "USD",
    sourceType: "test_supplier_payment_liability",
    sourceId: purchase.id,
    recognitionDate: new Date("2026-04-20"),
    historicalPoolDate: new Date("2026-04-20"),
    foreignAmount: 2000,
    carryingAmountPkr: 560000,
    rate: { ratePkr: 280, rateType: "test", provider: "LOCAL_TEST" },
    createdBy: superAdmin.id,
  }));

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
    const journalBeforeRejectedPayment = await prisma.journalEntry.findMany({ where: { transactionId: `SUPPPAY-${firstId}` } });
    assert.ok(journalBeforeRejectedPayment.length >= 2);
    assert.equal(
      journalBeforeRejectedPayment.reduce((sum, row) => sum + Number(row.debit), 0),
      journalBeforeRejectedPayment.reduce((sum, row) => sum + Number(row.credit), 0),
    );
    const layerBeforeRejectedPayment = await prisma.intermediaryUsdCostLayer.findUniqueOrThrow({ where: { id: layer.id } });

    const overpaymentRequest = new NextRequest("http://localhost/api/v1/supplier-payments", {
      method: "POST",
      headers: { ...headers, "x-sync-request-id": `${syncRequestId}-overpayment` },
      body: JSON.stringify({ ...payload, amountUsd: 800, reference: "capacity-test" }),
    });
    const overpaymentResponse = await createSupplierPayment(overpaymentRequest, { params: {} });
    const overpaymentJson = (await overpaymentResponse.json()) as any;
    assert.equal(overpaymentResponse.status, 400);
    assert.match(overpaymentJson.error?.message, /exceeds this supplier's outstanding purchase amount/i);
    assert.equal(await prisma.supplierPayment.count({ where: { supplierId: supplier.id } }), 1);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `SUPPPAY-${firstId}` } }), journalBeforeRejectedPayment.length);
    const layerAfterRejectedPayment = await prisma.intermediaryUsdCostLayer.findUniqueOrThrow({ where: { id: layer.id } });
    assert.equal(Number(layerAfterRejectedPayment.remainingAmountUsd), Number(layerBeforeRejectedPayment.remainingAmountUsd));

    const rejectedEdit = new NextRequest(`http://localhost/api/v1/supplier-payments/${firstId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ amountUsd: 2100 }),
    });
    const rejectedEditResponse = await updateSupplierPayment(rejectedEdit, { params: { id: String(firstId) } });
    const rejectedEditJson = (await rejectedEditResponse.json()) as any;
    assert.equal(rejectedEditResponse.status, 400);
    assert.match(rejectedEditJson.error?.message, /exceeds this supplier's outstanding purchase amount/i);
    assert.equal(Number((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: firstId } })).amountUsd), 1234);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `SUPPPAY-${firstId}` } }), journalBeforeRejectedPayment.length);
    assert.equal(Number((await prisma.intermediaryUsdCostLayer.findUniqueOrThrow({ where: { id: layer.id } })).remainingAmountUsd), Number(layerBeforeRejectedPayment.remainingAmountUsd));

    const deleteRequest = new NextRequest(`http://localhost/api/v1/supplier-payments/${firstId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteResponse = await deleteSupplierPayment(deleteRequest, { params: { id: String(firstId) } });
    assert.equal(deleteResponse.status, 200);
    assert.ok((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: firstId } })).deletedAt);
    assert.equal(Number((await prisma.intermediaryUsdCostLayer.findUniqueOrThrow({ where: { id: layer.id } })).remainingAmountUsd), 3000);
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
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "supplier_payment", sourceId: createdPaymentId } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { sourceType: "supplier_payment", sourceId: createdPaymentId } });
    }
    await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "test_supplier_payment_liability", sourceId: purchase.id } });
    await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: payableLayer.id } });
    await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "test_supplier_payment_funding", sourceId: deposit.id } });
    await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: carryingLayer.id } });
    await prisma.supplierPayment.deleteMany({ where: { supplierId: supplier.id, reference: "sync-test" } });
    await prisma.intermediaryUsdCostLayer.deleteMany({ where: { id: layer.id } });
    await prisma.intermediaryDeposit.deleteMany({ where: { id: deposit.id } });
    await prisma.lotPurchase.deleteMany({ where: { id: purchase.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
    await prisma.supplier.deleteMany({ where: { id: supplier.id } });
  }
});
