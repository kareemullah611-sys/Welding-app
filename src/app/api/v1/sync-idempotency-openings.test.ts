import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { GET as getOpenings, POST as saveOpening } from "@/app/api/v1/openings/route";

test("opening cash save is idempotent for repeated sync request id", async () => {
  const city = await prisma.city.findFirst({
    where: { name: "Quetta", country: { code: "PK" } },
  });
  assert.ok(city, "Seed city Quetta (PK) is required for this test");

  const cityCurrency = await prisma.cityCurrency.findFirst({
    where: { cityId: city.id, currency: { code: "PKR" } },
  });
  assert.ok(cityCurrency, "PKR must be configured for Quetta");

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
  const journalsBefore = openingBefore
    ? await prisma.journalEntry.findMany({ where: { entityType: "opening_cash", entityId: openingBefore.id } })
    : [];
  const cashAccountCode = `1001-CITY${city.id}`;
  const cashAccountBefore = await prisma.account.findUnique({ where: { code: cashAccountCode } });

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

    const savedOpening = await prisma.openingCash.findUnique({ where: { id: rowId } });
    assert.ok(savedOpening, "Opening cash row should be persisted");
    assert.equal(Number(savedOpening.amount), 98765);
    assert.equal(Number(savedOpening.carryingAmountPkr), 98765);
    assert.equal(Number(savedOpening.fxRateToPkr), 1);

    const journalRows = await prisma.journalEntry.findMany({
      where: { entityType: "opening_cash", entityId: rowId },
      orderBy: [{ transactionId: "asc" }, { lineNumber: "asc" }],
    });
    const currentJournalRows = journalRows.filter((row) => !row.transactionId.startsWith("REV-"));
    assert.equal(currentJournalRows.length, 2, "Opening cash should create one balanced journal pair");
    assert.equal(currentJournalRows.reduce((sum, row) => sum + Number(row.debit), 0), 98765);
    assert.equal(currentJournalRows.reduce((sum, row) => sum + Number(row.credit), 0), 98765);
    assert.ok(currentJournalRows.every((row) => row.currencyCode === "PKR"));

    const getRequest = new NextRequest("http://localhost/api/v1/openings", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    const getResponse = await getOpenings(getRequest, { params: {} });
    const getJson = (await getResponse.json()) as any;
    assert.equal(getJson.success, true);
    const displayedOpening = getJson.data?.openingCash?.find((row: any) => row.id === rowId);
    assert.ok(displayedOpening, "Saved opening should be returned by the openings read API");
    assert.equal(displayedOpening.amount, 98765);
    assert.equal(displayedOpening.carryingAmountPkr, 98765);

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
      await prisma.auditLog.deleteMany({
        where: { entityType: "opening_cashes", entityId: rowId, userId: user.id },
      });
      await prisma.journalEntry.deleteMany({
        where: { entityType: "opening_cash", entityId: rowId },
      });
      if (openingBefore) {
        await prisma.openingCash.update({
          where: { id: rowId },
          data: {
            amount: openingBefore.amount,
            carryingAmountPkr: openingBefore.carryingAmountPkr,
            fxRateToPkr: openingBefore.fxRateToPkr,
            fxRateDate: openingBefore.fxRateDate,
            fxRateSource: openingBefore.fxRateSource,
            fxRateMetadata: openingBefore.fxRateMetadata ?? undefined,
            openingDate: openingBefore.openingDate,
            notes: openingBefore.notes,
            createdBy: openingBefore.createdBy,
          },
        });
        if (journalsBefore.length > 0) {
          await prisma.journalEntry.createMany({ data: journalsBefore });
        }
      } else {
        await prisma.openingCash.deleteMany({
          where: { id: rowId, cityId: city.id, currencyId: cityCurrency.currencyId },
        });
      }
      if (!cashAccountBefore) {
        await prisma.account.deleteMany({ where: { code: cashAccountCode } });
      }
    }
  }
});
