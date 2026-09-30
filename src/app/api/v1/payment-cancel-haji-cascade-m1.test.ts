import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { POST as createPayment } from "@/app/api/v1/payments/route";
import { PUT as cancelPayment } from "@/app/api/v1/payments/[id]/cancel/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("M1: cancelling a haji-destination payment cascades to its linked haji transfer", async () => {
  const marker = `m1-${Date.now()}`;
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const admin = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(admin, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  const token = generateToken({
    userId: admin.id,
    username: admin.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });

  const customer = await prisma.customer.create({ data: { cityId: city.id, name: `${marker}-customer`, isActive: true } });
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `${marker}-lot`, lotDate: new Date("2026-04-01"), status: "ongoing", createdBy: admin.id },
  });
  const distribution = await prisma.lotCityDistribution.create({
    data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 100 },
  });
  const bankAccount = await prisma.bankAccount.create({
    data: { cityId: city.id, bankName: `${marker}-bank`, accountNumber: "0001", isActive: true },
  });
  const superBank = await prisma.superAdminBankAccount.create({
    data: { bankName: `${marker}-superbank`, currencyId: pkr.id, createdBy: admin.id },
  });

  let paymentId = 0;
  let transferId = 0;
  const txnIds: string[] = [];
  try {
    const createRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          customerId: customer.id,
          lotId: lot.id,
          paymentDate: "2026-04-24",
          detail: marker,
          amount: 500,
          currencyId: pkr.id,
          paymentMethod: "bank_transfer",
          destination: "haji",
          superAdminBankAccountId: superBank.id,
        }),
      }),
      { params: {} }
    );
    const createJson = (await createRes.json()) as any;
    assert.equal(createRes.status, 201, `payment create failed: ${JSON.stringify(createJson)}`);
    paymentId = createJson.data.id;

    const transfer = await prisma.hajiTransfer.findFirst({ where: { paymentId } });
    assert.ok(transfer, "seed precondition: payment must link a haji transfer");
    transferId = transfer.id;
    txnIds.push(`PAY-${paymentId}`, `HAJI-${transferId}`);

    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `HAJI-${transferId}` } }), 2, "seed precondition: HAJI journal exists");

    const cancelRes = await cancelPayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}/cancel`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ reason: "M1 cascade test" }),
      }),
      { params: { id: String(paymentId) } }
    );
    const cancelJson = (await cancelRes.json()) as any;
    assert.equal(cancelRes.status, 200, `cancel failed: ${JSON.stringify(cancelJson)}`);

    assert.equal(await prisma.hajiTransfer.count({ where: { paymentId } }), 0, "linked haji transfer must be cascade-removed");
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `REV-HAJI-${transferId}` } }),
      2,
      "HAJI journal must be reversed (REV-HAJI pair), not erased"
    );
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `HAJI-${transferId}` } }),
      2,
      "original HAJI journal rows must be preserved"
    );
    const cancelled = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
    assert.equal(cancelled?.status, "cancelled", "payment must be cancelled");
  } finally {
    const seeds = [paymentId ? `PAY-${paymentId}` : null, paymentId ? `REV-PAY-${paymentId}` : null, transferId ? `HAJI-${transferId}` : null, transferId ? `REV-HAJI-${transferId}` : null].filter(Boolean) as string[];
    const unique = Array.from(new Set([...txnIds, ...seeds]));
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: unique } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "payments", entityId: paymentId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "haji_transfers", entityId: transferId || -1 } });
    if (transferId) await prisma.hajiTransfer.deleteMany({ where: { id: transferId } });
    if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.account.deleteMany({ where: { code: `1050-BANK${bankAccount.id}`, journalEntries: { none: {} } } });
    await prisma.account.deleteMany({ where: { code: `1050-SABANK${superBank.id}`, journalEntries: { none: {} } } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: superBank.id } });
    await prisma.bankAccount.deleteMany({ where: { id: bankAccount.id } });
    await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
  }
});
