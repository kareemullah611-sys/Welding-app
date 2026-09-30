import assert from "node:assert/strict";
import test from "node:test";

import prisma from "@/lib/prisma";
import { journalSuperAdminLiabilityEntry } from "@/lib/accounting";

test("P6: super-admin liability journals carry the source row's cityId", async () => {
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  const city = await prisma.city.findFirst({ select: { id: true } });
  assert.ok(city, "At least one seed city is required");

  const marker = `P6${Date.now()}`.slice(0, 16);
  const entryId = 987654321;
  const transactionId = `SALIAB-${entryId}`;
  const control = await prisma.account.create({
    data: { code: `${marker}CTRL`.slice(0, 20), name: "P6 control", accountType: "liability", isActive: true },
  });
  const counter = await prisma.account.create({
    data: { code: `${marker}CNT`.slice(0, 20), name: "P6 counter", accountType: "expense", isActive: true },
  });
  try {
    await journalSuperAdminLiabilityEntry({
      id: entryId,
      entryType: "liability_incurred",
      controlAccountId: control.id,
      counterAccountId: counter.id,
      pkrAmount: 1000,
      entryDate: new Date("2026-09-15"),
      createdBy: superadmin.id,
      cityId: city.id,
      description: `P6 city scoping ${marker}`,
    });

    const rows = await prisma.journalEntry.findMany({ where: { transactionId } });
    assert.equal(rows.length, 2, "both journal lines must exist");
    assert.ok(
      rows.every((r) => r.cityId === city.id),
      `both lines must carry the liability entry's cityId ${city.id}; got ${JSON.stringify(rows.map((r) => r.cityId))}`,
    );
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId } });
    await prisma.account.deleteMany({ where: { id: { in: [control.id, counter.id] } } });
  }
});
