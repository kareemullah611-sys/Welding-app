import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as saveOpening } from "@/app/api/v1/openings/route";

test("opening cash save is idempotent for repeated sync request id", async () => {
  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const cityCurrency = await prisma.cityCurrency.findFirst({
    where: { cityId: city.id },
    orderBy: { currencyId: "asc" },
  });
  assert.ok(cityCurrency, "At least one city currency is required for Quetta");

  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required for this test");

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  const syncRequestId = `req-opening-${Date.now()}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-sync-request-id": syncRequestId,
    "x-sync-device-id": "device-test-1",
  };

  const openingBefore = await prisma.openingCash.findFirst({
    where: { cityId: city.id, currencyId: cityCurrency.currencyId },
  });
  const prevAmount = openingBefore ? Number(openingBefore.amount) : null;
  const prevDate = openingBefore?.openingDate || null;
  const prevNotes = openingBefore?.notes || null;
  const prevCreatedBy = openingBefore?.createdBy || null;

  const payload = {
    kind: "cash",
    cityId: city.id,
    currencyId: cityCurrency.currencyId,
    amount: 98765,
    openingDate: "2026-04-27",
    notes: "sync opening test",
  };

  let rowId: number | null = null;

  try {
    const firstRequest = new NextRequest("http://localhost/api/v1/openings", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const firstResponse = await saveOpening(firstRequest, { params: {} });
    const firstJson = (await firstResponse.json()) as any;
    assert.equal(firstJson.success, true);
    rowId = firstJson.data?.id;
    assert.ok(rowId, "First call should return opening id");

    const secondRequest = new NextRequest("http://localhost/api/v1/openings", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const secondResponse = await saveOpening(secondRequest, { params: {} });
    const secondJson = (await secondResponse.json()) as any;
    assert.equal(secondJson.success, true);
    assert.equal(secondJson.data?.id, rowId, "Replay should return same opening record");

    const syncRow = await prisma.syncRequest.findUnique({
      where: {
        unique_sync_request_per_city_module: {
          cityId: city.id,
          module: "openings",
          requestId: syncRequestId,
        },
      },
    });
    assert.ok(syncRow, "Sync request row should be persisted");
    assert.equal(syncRow?.entityId, rowId);
  } finally {
    await prisma.syncRequest.deleteMany({
      where: {
        cityId: city.id,
        module: "openings",
        requestId: syncRequestId,
      },
    });
    if (rowId) {
      if (openingBefore) {
        await prisma.openingCash.update({
          where: { id: rowId },
          data: {
            amount: prevAmount!,
            openingDate: prevDate!,
            notes: prevNotes,
            createdBy: prevCreatedBy || user.id,
          },
        });
      } else {
        await prisma.openingCash.deleteMany({
          where: { id: rowId, cityId: city.id, currencyId: cityCurrency.currencyId },
        });
      }
    }
  }
});
