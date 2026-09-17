import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createLotCost } from "@/app/api/v1/lot-costs/route";

test("lot cost create is idempotent for repeated sync request id", async () => {
  const marker = `sync-lot-cost-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superAdmin, "Seed user superadmin is required for this test");

  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const country = await prisma.country.findFirst({ where: { code: "PK" } });
  assert.ok(country, "Seed country PK is required");

  const lot = await prisma.lot.create({
    data: {
      countryId: country.id,
      lotNumber: marker,
      lotDate: new Date("2026-04-27"),
      notes: "sync test",
      createdBy: superAdmin.id,
      status: "ongoing",
    },
  });
  const product = await prisma.product.create({
    data: { name: `${marker}-product`, unitOfMeasure: "MT", defaultWeightPerCartonKg: 25 },
  });
  await prisma.lotProduct.create({
    data: { lotId: lot.id, productId: product.id, totalQty: 100 },
  });
  const supplier = await prisma.supplier.create({
    data: { name: `${marker}-supplier`, country: "Pakistan", contact: "sync test" },
  });
  const purchase = await prisma.lotPurchase.create({
    data: {
      lotId: lot.id,
      supplierId: supplier.id,
      productId: product.id,
      qty: 2.5,
      weightPerCartonKg: 25,
      unitPriceUsd: 1_000,
      totalPriceUsd: 2_500,
      carryingRatePkr: 280,
      carryingAmountPkr: 700_000,
      recognitionDate: lot.lotDate,
      createdBy: superAdmin.id,
    },
  });

  const syncRequestId = `req-lot-cost-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const payload = {
    lotId: lot.id,
    costType: "customs_duty",
    description: marker,
    amount: 4444,
    currencyCode: "PKR",
    supplierId: supplier.id,
    notes: "offline replay test",
  };
  let createdCostId: number | null = null;

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/lot-costs", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await createLotCost(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstResponse.status, 201);
    assert.equal(firstJson.success, true);
    const firstId = firstJson.data?.id;
    assert.ok(firstId, "First call should return created id");
    createdCostId = firstId;

    const secondRequest = new NextRequest("http://localhost/api/v1/lot-costs", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await createLotCost(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, firstId, "Replay should return the same lot cost");

    const createdRows = await prisma.lotCost.findMany({
      where: { lotId: lot.id, description: marker },
    });
    assert.equal(createdRows.length, 1, "Only one lot cost row should exist for replayed request");
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: 0,
        module: "lot_costs",
        requestId: syncRequestId,
      },
    });
    if (createdCostId) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "lot_costs", entityId: createdCostId },
      });
      await prisma.journalEntry.deleteMany({
        where: { entityType: "lot_cost", entityId: createdCostId },
      });
    }
    await prisma.lotCost.deleteMany({ where: { lotId: lot.id, description: marker } });
    await prisma.lotPurchase.deleteMany({ where: { id: purchase.id } });
    await prisma.supplier.deleteMany({ where: { id: supplier.id } });
    await prisma.lotProduct.deleteMany({ where: { lotId: lot.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
  }

  if (createdCostId) {
    const orphanJournalCount = await prisma.journalEntry.count({
      where: { entityType: "lot_cost", entityId: createdCostId },
    });
    assert.equal(orphanJournalCount, 0, "Test cleanup must not leave an orphan lot-cost journal");
  }
});
