import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { getCashAccountId, getCustomerAccountId } from "@/lib/accounting";
import { POST as createExpense } from "@/app/api/v1/expenses/route";
import { DELETE as deleteExpense } from "@/app/api/v1/expenses/[id]/route";
import { POST as createWithdrawal } from "@/app/api/v1/personal-withdrawals/route";
import { DELETE as deleteWithdrawal } from "@/app/api/v1/personal-withdrawals/[id]/route";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function scopedNet(accountId: number, transactionIds: string[]): Promise<number> {
  const rows = await prisma.journalEntry.findMany({
    where: { accountId, transactionId: { in: transactionIds } },
    select: { debit: true, credit: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0);
}

async function seed() {
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const user = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(user, "Seed user quetta_admin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: pkr.id } },
    update: {},
    create: { cityId: city.id, currencyId: pkr.id },
  });
  const customer = await prisma.customer.create({
    data: { cityId: city.id, name: `c2fd-${Date.now()}-customer`, isActive: true },
  });
  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "city_admin",
    cityId: city.id,
    countryId: city.countryId,
  });
  return { city, customer, pkr, token };
}

test("C2: deleting a customer-funded expense reverses PAY journals instead of erasing them", async () => {
  const marker = `c2-exp-${Date.now()}`;
  const { city, customer, pkr, token } = await seed();
  let expenseId = 0;
  let paymentId = 0;

  try {
    const createRes = await createExpense(
      new NextRequest("http://localhost/api/v1/expenses", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          expenseDate: "2026-04-24",
          amount: 123456,
          currencyId: pkr.id,
          detail: marker,
          paidFrom: "customer",
          customerId: customer.id,
        }),
      }),
      { params: {} }
    );
    const createJson = (await createRes.json()) as any;
    assert.equal(createRes.status, 201, `expense create failed: ${JSON.stringify(createJson)}`);
    expenseId = createJson.data.id;
    paymentId = createJson.data.customerPaymentId;
    assert.ok(paymentId, "customer-funded expense must link a payment");

    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `EXP-${expenseId}` } }), 2, "seed precondition: EXP journal");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "seed precondition: PAY journal");

    const cashAccount = await getCashAccountId(city.id);
    const arAccount = await getCustomerAccountId(customer.id);
    const txnIds = [`EXP-${expenseId}`, `REV-EXP-${expenseId}`, `PAY-${paymentId}`, `REV-PAY-${paymentId}`];
    const cashBefore = await scopedNet(cashAccount, txnIds);
    assert.equal(cashBefore, 0, "seed precondition: customer-funded expense nets city cash to zero");

    const deleteRes = await deleteExpense(
      new NextRequest(`http://localhost/api/v1/expenses/${expenseId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      }),
      { params: { id: String(expenseId) } }
    );
    const deleteJson = (await deleteRes.json()) as any;
    assert.equal(deleteRes.status, 200, `expense delete failed: ${JSON.stringify(deleteJson)}`);

    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    assert.ok(expense && expense.deletedAt !== null, "expense must be soft-deleted");
    assert.equal(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "payment row must be removed");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-EXP-${expenseId}` } }), 2, "EXP must be reversed, not erased");
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }),
      2,
      "PAY journal must be preserved (erasing GL history is forbidden)"
    );
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }),
      2,
      "PAY journal must carry a REV-PAY reversal pair"
    );
    assert.equal(await scopedNet(cashAccount, txnIds), 0, "city cash GL net must stay zero after delete");
    assert.equal(await scopedNet(arAccount, [`PAY-${paymentId}`, `REV-PAY-${paymentId}`]), 0, "customer AR GL net must stay zero after delete");
  } finally {
    await prisma.journalEntry.deleteMany({
      where: {
        transactionId: {
          in: [`EXP-${expenseId}`, `REV-EXP-${expenseId}`, `PAY-${paymentId}`, `REV-PAY-${paymentId}`],
        },
      },
    });
    if (expenseId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "expenses", entityId: expenseId } });
      await prisma.expense.deleteMany({ where: { id: expenseId } });
    }
    await prisma.payment.deleteMany({ where: { id: paymentId || -1 } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}` } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }
});

test("C2: deleting a customer-funded withdrawal reverses PAY journals instead of erasing them", async () => {
  const marker = `c2-wd-${Date.now()}`;
  const { city, customer, pkr, token } = await seed();
  let withdrawalId = 0;
  let paymentId = 0;
  let hajiId = 0;

  try {
    const createRes = await createWithdrawal(
      new NextRequest("http://localhost/api/v1/personal-withdrawals", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          withdrawalDate: "2026-04-24",
          amount: 654321,
          currencyId: pkr.id,
          detail: marker,
          withdrawnBy: "C2 Test",
          sourceType: "customer",
          customerId: customer.id,
        }),
      }),
      { params: {} }
    );
    const createJson = (await createRes.json()) as any;
    assert.equal(createRes.status, 201, `withdrawal create failed: ${JSON.stringify(createJson)}`);
    withdrawalId = createJson.data.id;
    paymentId = createJson.data.customerPaymentId;
    hajiId = createJson.data.hajiTransferId;
    assert.ok(paymentId, "customer-funded withdrawal must link a payment");
    assert.ok(hajiId, "withdrawal must link a haji transfer");

    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `HAJI-${hajiId}` } }), 2, "seed precondition: HAJI journal");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "seed precondition: PAY journal");

    const cashAccount = await getCashAccountId(city.id);
    const arAccount = await getCustomerAccountId(customer.id);
    const txnIds = [`HAJI-${hajiId}`, `REV-HAJI-${hajiId}`, `PAY-${paymentId}`, `REV-PAY-${paymentId}`];
    const cashBefore = await scopedNet(cashAccount, txnIds);
    assert.equal(cashBefore, 0, "seed precondition: customer-funded withdrawal nets city cash to zero");

    const deleteRes = await deleteWithdrawal(
      new NextRequest(`http://localhost/api/v1/personal-withdrawals/${withdrawalId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      }),
      { params: { id: String(withdrawalId) } }
    );
    const deleteJson = (await deleteRes.json()) as any;
    assert.equal(deleteRes.status, 200, `withdrawal delete failed: ${JSON.stringify(deleteJson)}`);

    assert.equal(await prisma.personalWithdrawal.findUnique({ where: { id: withdrawalId } }), null, "withdrawal row must be removed");
    assert.equal(await prisma.hajiTransfer.findUnique({ where: { id: hajiId } }), null, "haji transfer row must be removed");
    assert.equal(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "payment row must be removed");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-HAJI-${hajiId}` } }), 2, "HAJI must be reversed, not erased");
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }),
      2,
      "PAY journal must be preserved (erasing GL history is forbidden)"
    );
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }),
      2,
      "PAY journal must carry a REV-PAY reversal pair"
    );
    assert.equal(await scopedNet(cashAccount, txnIds), 0, "city cash GL net must stay zero after delete");
    assert.equal(await scopedNet(arAccount, [`PAY-${paymentId}`, `REV-PAY-${paymentId}`]), 0, "customer AR GL net must stay zero after delete");
  } finally {
    await prisma.journalEntry.deleteMany({
      where: {
        transactionId: {
          in: [`HAJI-${hajiId}`, `REV-HAJI-${hajiId}`, `PAY-${paymentId}`, `REV-PAY-${paymentId}`],
        },
      },
    });
    if (withdrawalId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "personal_withdrawals", entityId: withdrawalId } });
    }
    if (hajiId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "haji_transfers", entityId: hajiId } });
    }
    await prisma.payment.deleteMany({ where: { id: paymentId || -1 } });
    await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}` } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }
});
