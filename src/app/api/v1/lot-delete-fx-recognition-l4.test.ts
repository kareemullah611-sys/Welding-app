import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { foreignCurrencyOwnerKey, recordForeignCurrencyRecognition } from "@/lib/foreign-currency-carrying-db";
import { DELETE as deleteLot } from "@/app/api/v1/lots/[id]/route";

test("L4: deleting a lot reverses its lot_shipping_cost foreign recognition layer", async () => {
  const marker = `l4-${Date.now()}`;
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(admin, "Seed user superadmin is required");
  const token = generateToken({
    userId: admin.id, username: admin.username, role: "super_admin",
    cityId: null, countryId: null,
  });

  const shippingLine = await prisma.shippingLine.create({ data: { name: `${marker}-line` } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: admin.id },
  });
  let costId = 0;
  let layerId = 0;
  try {
    const cost = await prisma.lotCost.create({
      data: {
        lotId: lot.id, costType: "freight", description: `${marker}-freight`,
        amount: 100, currencyCode: "USD", shippingLineId: shippingLine.id,
        costDate: new Date("2026-04-10"), exchangeRate: 278, createdBy: admin.id,
      },
    });
    costId = cost.id;

    const layer = await recordForeignCurrencyRecognition(prisma, {
      positionKind: "liability",
      positionType: "shipping_payable",
      ownerKey: foreignCurrencyOwnerKey.shippingPayable(shippingLine.id, lot.id),
      currencyCode: "USD",
      sourceType: "lot_shipping_cost",
      sourceId: costId,
      recognitionDate: new Date("2026-04-10"),
      historicalPoolDate: new Date("2026-04-10"),
      foreignAmount: 100,
      carryingAmountPkr: 27800,
      rate: {
        ratePkr: 278,
        rateType: "documented_lot_cost_rate",
        provider: "LOT_COST_RECOGNITION_RATE",
        reference: `lot_cost:${costId}`,
      },
      createdBy: admin.id,
    });
    layerId = (layer as any).id;
    assert.equal((layer as any).status, "open", "seed precondition: recognition layer is open");

    const res = await deleteLot(
      new NextRequest(`http://localhost/api/v1/lots/${lot.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }),
      { params: { id: String(lot.id) } }
    );
    const json = (await res.json()) as any;
    assert.equal(res.status, 200, `lot delete must succeed: ${JSON.stringify(json)}`);

    const after = await prisma.foreignCurrencyCarryingLayer.findUnique({ where: { id: layerId } });
    assert.equal(after?.status, "reversed", "lot delete must reverse the shipping-cost recognition layer");

    const movement = await prisma.foreignCurrencyMovement.findFirst({
      where: { sourceType: "lot_shipping_cost", sourceId: costId, movementType: "reversal" },
    });
    assert.ok(movement, "a reversal movement row must be recorded");
  } finally {
    if (costId) {
      await prisma.foreignCurrencyMovement.deleteMany({ where: { sourceType: "lot_shipping_cost", sourceId: costId } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { sourceType: "lot_shipping_cost", sourceId: costId } });
    }
    await prisma.auditLog.deleteMany({ where: { entityType: "lots", entityId: lot.id } });
    await prisma.lotCost.deleteMany({ where: { id: costId || -1 } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.shippingLine.deleteMany({ where: { id: shippingLine.id } });
  }
});
