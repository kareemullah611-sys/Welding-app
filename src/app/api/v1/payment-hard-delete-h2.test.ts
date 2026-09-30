import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { generateToken, hashPassword } from "@/lib/auth";
import { POST as createPayment } from "@/app/api/v1/payments/route";
import { POST as createDeposit } from "@/app/api/v1/bank-deposits/route";
import { POST as createExpense } from "@/app/api/v1/expenses/route";
import { DELETE as hardDeletePayment } from "@/app/api/v1/payments/[id]/hard-delete/route";
import { reverseJournalEntries, getCustomerAccountId, getSalesRevenueAccountId } from "@/lib/accounting";

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function seed() {
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  assert.ok(city, "Seed city Quetta (PK) is required");
  const cityUser = await prisma.user.findUnique({ where: { username: "quetta_admin" } });
  assert.ok(cityUser, "Seed user quetta_admin is required");
  const superadmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  assert.ok(superadmin, "Seed user superadmin is required");
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(pkr, "Seed currency PKR is required");
  await prisma.cityCurrency.upsert({
    where: { cityId_currencyId: { cityId: city.id, currencyId: pkr.id } },
    update: {},
    create: { cityId: city.id, currencyId: pkr.id },
  });
  const customer = await prisma.customer.create({
    data: { cityId: city.id, name: `h2-${Date.now()}-customer`, isActive: true },
  });
  const product = await prisma.product.create({ data: { name: `h2-${Date.now()}-product`, isActive: true } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: `h2-${Date.now()}-lot`, lotDate: new Date("2026-03-01"), status: "ongoing", createdBy: cityUser.id },
  });
  await prisma.lotCityDistribution.create({ data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 50 } });

  const cityToken = generateToken({
    userId: cityUser.id, username: cityUser.username, role: "city_admin", cityId: city.id, countryId: city.countryId,
  });
  const superToken = generateToken({
    userId: superadmin.id, username: superadmin.username, role: "super_admin", cityId: null, countryId: null,
  });
  const originalHash = superadmin.passwordHash;
  const testPassword = "H2-HardDelete-Test-1!";
  await prisma.user.update({ where: { id: superadmin.id }, data: { passwordHash: await hashPassword(testPassword) } });

  return { city, pkr, customer, product, lot, cityToken, superToken, testPassword, originalHash, superadminId: superadmin.id };
}

async function cleanup(ids: {
  paymentIds: number[]; expenseIds: number[]; depositIds: number[]; customerIds: number[];
  lotIds: number[]; productIds: number[]; bankAccountIds: number[];
}) {
  await prisma.journalEntry.deleteMany({ where: { transactionId: { in: ids.paymentIds.flatMap((id) => [`PAY-${id}`, `REV-PAY-${id}`]) } } });
  await prisma.journalEntry.deleteMany({ where: { transactionId: { in: ids.expenseIds.flatMap((id) => [`EXP-${id}`, `REV-EXP-${id}`]) } } });
  if (ids.depositIds.length) {
    await prisma.journalEntry.deleteMany({ where: { entityType: "bank_deposit", entityId: { in: ids.depositIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { OR: [
    { entityType: "payments", entityId: { in: ids.paymentIds } },
    { entityType: "expenses", entityId: { in: ids.expenseIds } },
    ...(ids.depositIds.length ? [{ entityType: "bank_deposits", entityId: { in: ids.depositIds } }] : []),
  ] } });
  await prisma.bankDeposit.deleteMany({ where: { id: { in: ids.depositIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: ids.expenseIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: ids.paymentIds } } });
  await prisma.account.deleteMany({ where: { code: { in: ids.customerIds.map((id) => `1200-C${id}`) } } });
  await prisma.lotCityDistribution.deleteMany({ where: { lotId: { in: ids.lotIds } } });
  await prisma.lot.deleteMany({ where: { id: { in: ids.lotIds } } });
  await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customerIds } } });
  await prisma.bankAccount.deleteMany({ where: { id: { in: ids.bankAccountIds } } });
  await prisma.account.deleteMany({
    where: { code: { in: ids.bankAccountIds.map((id) => `1050-BANK${id}`) }, journalEntries: { none: {} } },
  });
}

test("H2: hard-delete is blocked for a cheque that belongs to a bank deposit", async () => {
  const marker = `h2-dep-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  const depositIds: number[] = [];
  const bankAccountIds: number[] = [];
  try {
    const payRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          customerId: s.customer.id, paymentDate: "2026-04-24", amount: 555000, currencyId: s.pkr.id,
          paymentMethod: "cheque", destination: "our_account", detail: marker,
          chequeNumber: `${marker}-chq`, chequeBank: "HBL", chequeDueDate: "2026-05-15",
        }),
      }),
      { params: {} }
    );
    const payJson = (await payRes.json()) as any;
    assert.equal(payRes.status, 201, `cheque payment create failed: ${JSON.stringify(payJson)}`);
    const paymentId = payJson.data.id;
    paymentIds.push(paymentId);

    const bankAccount = await prisma.bankAccount.create({
      data: { cityId: s.city.id, bankName: `${marker}-bank`, accountNumber: "0000", isActive: true },
    });
    bankAccountIds.push(bankAccount.id);

    const depRes = await createDeposit(
      new NextRequest("http://localhost/api/v1/bank-deposits", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          transferType: "cheque_to_bank", bankAccountId: bankAccount.id, depositDate: "2026-04-25",
          currencyId: s.pkr.id, chequePaymentIds: [paymentId], slipNumber: `${marker}-slip`,
        }),
      }),
      { params: {} }
    );
    const depJson = (await depRes.json()) as any;
    assert.ok(depRes.status < 400, `deposit create failed: ${JSON.stringify(depJson)}`);
    depositIds.push(depJson.data?.id ?? depJson.id);

    const deposited = await prisma.payment.findUnique({ where: { id: paymentId } });
    assert.equal((deposited as any)?.chequeStatus, "deposited_to_bank", "seed precondition: cheque is deposited");
    assert.ok((deposited as any)?.bankDepositId, "seed precondition: cheque belongs to a deposit");

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(paymentId) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(
      delRes.status, 409,
      `hard-delete of a deposited cheque must be blocked with 409, got ${delRes.status}: ${JSON.stringify(delJson)}`
    );
    assert.notEqual(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "payment must survive the blocked delete");
  } finally {
    await cleanup({ paymentIds, expenseIds: [], depositIds, customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});

test("H2: hard-delete is blocked with a clear conflict when an expense still uses the cheque", async () => {
  const marker = `h2-exp-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  const expenseIds: number[] = [];
  try {
    const payRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          customerId: s.customer.id, paymentDate: "2026-04-24", amount: 444000, currencyId: s.pkr.id,
          paymentMethod: "cheque", destination: "our_account", detail: marker,
          chequeNumber: `${marker}-chq`, chequeBank: "HBL", chequeDueDate: "2026-05-15",
        }),
      }),
      { params: {} }
    );
    const payJson = (await payRes.json()) as any;
    assert.equal(payRes.status, 201, `cheque payment create failed: ${JSON.stringify(payJson)}`);
    const paymentId = payJson.data.id;
    paymentIds.push(paymentId);

    const expRes = await createExpense(
      new NextRequest("http://localhost/api/v1/expenses", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          expenseDate: "2026-04-26", amount: 444000, currencyId: s.pkr.id, detail: marker,
          paidFrom: "cheque", chequePaymentId: paymentId,
        }),
      }),
      { params: {} }
    );
    const expJson = (await expRes.json()) as any;
    assert.equal(expRes.status, 201, `expense create failed: ${JSON.stringify(expJson)}`);
    expenseIds.push(expJson.data.id);
    const used = await prisma.payment.findUnique({ where: { id: paymentId } });
    assert.equal((used as any)?.chequeStatus, "used_for_expense", "seed precondition: cheque is used for an expense");

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(paymentId) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(
      delRes.status, 409,
      `hard-delete of an expense-used cheque must be blocked with 409, got ${delRes.status}: ${JSON.stringify(delJson)}`
    );
    assert.notEqual(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "payment must survive the blocked delete");
  } finally {
    await cleanup({ paymentIds, expenseIds, depositIds: [], customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds: [] });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});

test("H2: hard-delete is blocked for a cancelled payment so its reversal journals stay intact", async () => {
  const marker = `h2-can-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  try {
    const payRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          customerId: s.customer.id, paymentDate: "2026-04-24", amount: 777000, currencyId: s.pkr.id,
          paymentMethod: "cash", destination: "our_account", detail: marker,
        }),
      }),
      { params: {} }
    );
    const payJson = (await payRes.json()) as any;
    assert.equal(payRes.status, 201, `cash payment create failed: ${JSON.stringify(payJson)}`);
    const paymentId = payJson.data.id;
    paymentIds.push(paymentId);

    // Seed post-cancel state exactly as the cancel route leaves it:
    // PAY rows reversed into REV-PAY rows, status flipped to cancelled.
    await reverseJournalEntries(`PAY-${paymentId}`, s.superadminId);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "cancelled", cancellationReason: marker } });
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }), 2, "seed precondition: reversal rows exist");

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(paymentId) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(
      delRes.status, 409,
      `hard-delete of a cancelled payment must be blocked with 409, got ${delRes.status}: ${JSON.stringify(delJson)}`
    );
    assert.equal(delJson.error?.code, "CONFLICT");
    assert.notEqual(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "cancelled payment must survive the blocked delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "PAY rows must survive the blocked delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${paymentId}` } }), 2, "reversal rows must survive — immutable audit history");
  } finally {
    await cleanup({ paymentIds, expenseIds: [], depositIds: [], customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds: [] });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});

test("H2: hard-delete refuses an active payment that has accounting history (PAY/ADJPAY preserved)", async () => {
  const marker = `h2-adj-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  try {
    const payRes = await createPayment(
      new NextRequest("http://localhost/api/v1/payments", {
        method: "POST", headers: authHeaders(s.cityToken),
        body: JSON.stringify({
          customerId: s.customer.id, paymentDate: "2026-04-24", amount: 333000, currencyId: s.pkr.id,
          paymentMethod: "cash", destination: "our_account", detail: marker,
        }),
      }),
      { params: {} }
    );
    const payJson = (await payRes.json()) as any;
    assert.equal(payRes.status, 201, `cash payment create failed: ${JSON.stringify(payJson)}`);
    const paymentId = payJson.data.id;
    paymentIds.push(paymentId);

    // Seed ADJPAY adjustment rows (walk-in discount/correct sync) owned by this payment.
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `ADJPAY-${paymentId}-0`, lineNumber: 1, accountId: await getCustomerAccountId(s.customer.id), debit: 500, credit: 0, currencyCode: "PKR", description: "H2 seed", entryDate: new Date("2026-04-24"), createdBy: s.superadminId },
        { transactionId: `ADJPAY-${paymentId}-0`, lineNumber: 2, accountId: await getSalesRevenueAccountId(), debit: 0, credit: 500, currencyCode: "PKR", description: "H2 seed", entryDate: new Date("2026-04-24"), createdBy: s.superadminId },
      ],
    });
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `ADJPAY-${paymentId}-0` } }), 2, "seed precondition: ADJPAY rows exist");

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${paymentId}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(paymentId) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(
      delRes.status, 409,
      `hard-delete of a payment with accounting history must be blocked with 409, got ${delRes.status}: ${JSON.stringify(delJson)}`
    );
    assert.equal(delJson.error?.code, "PAYMENT_HAS_ACCOUNTING_HISTORY");
    assert.notEqual(await prisma.payment.findUnique({ where: { id: paymentId } }), null, "payment must survive the refused delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${paymentId}` } }), 2, "PAY rows must survive — immutable accounting history");
    assert.equal(
      await prisma.journalEntry.count({ where: { transactionId: { startsWith: `ADJPAY-${paymentId}-` } } }),
      2,
      "ADJPAY adjustment rows must survive — immutable accounting history"
    );
  } finally {
    if (paymentIds.length) {
      await prisma.journalEntry.deleteMany({ where: { transactionId: { startsWith: `ADJPAY-${paymentIds[0]}-` } } });
    }
    await cleanup({ paymentIds, expenseIds: [], depositIds: [], customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds: [] });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});

test("H2: hard-delete still removes a journal-less payment row", async () => {
  const marker = `h2-jl-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  try {
    const payment = await prisma.payment.create({
      data: {
        cityId: s.city.id, customerId: s.customer.id, paymentDate: new Date("2026-04-24"),
        detail: marker, amount: 111000, currencyId: s.pkr.id, paymentMethod: "cash",
        destination: "our_account", createdBy: s.superadminId,
      },
    });
    paymentIds.push(payment.id);

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${payment.id}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(payment.id) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(delRes.status, 200, `expected 200 for a journal-less payment, got ${delRes.status}: ${JSON.stringify(delJson)}`);
    assert.equal(await prisma.payment.findUnique({ where: { id: payment.id } }), null, "journal-less payment row must be deleted");
  } finally {
    await cleanup({ paymentIds, expenseIds: [], depositIds: [], customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds: [] });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});

test("H2: hard-delete refuses a journal-less payment whose linked haji transfer still has HAJI journals", async () => {
  const marker = `h2-haji-jl-${Date.now()}`;
  const s = await seed();
  const paymentIds: number[] = [];
  const transferIds: number[] = [];
  try {
    // Codex edge case: the payment row has no PAY journals (journal-less), but it
    // is linked to a haji transfer that still carries its HAJI journals. Policy:
    // any accounting history means immutable — including HAJI/REV-HAJI rows.
    const payment = await prisma.payment.create({
      data: {
        cityId: s.city.id, customerId: s.customer.id, paymentDate: new Date("2026-04-24"),
        detail: marker, amount: 222000, currencyId: s.pkr.id, paymentMethod: "cash",
        destination: "haji", createdBy: s.superadminId,
      },
    });
    paymentIds.push(payment.id);
    const transfer = await prisma.hajiTransfer.create({
      data: {
        cityId: s.city.id, transferDate: new Date("2026-04-24"), amount: 222000,
        currencyId: s.pkr.id, detail: marker, transferType: "direct",
        paymentId: payment.id, createdBy: s.superadminId,
      },
    });
    transferIds.push(transfer.id);
    await prisma.journalEntry.createMany({
      data: [
        { transactionId: `HAJI-${transfer.id}`, lineNumber: 1, accountId: await getCustomerAccountId(s.customer.id), debit: 222000, credit: 0, currencyCode: "PKR", description: "H2 seed", entryDate: new Date("2026-04-24"), createdBy: s.superadminId },
        { transactionId: `HAJI-${transfer.id}`, lineNumber: 2, accountId: await getSalesRevenueAccountId(), debit: 0, credit: 222000, currencyCode: "PKR", description: "H2 seed", entryDate: new Date("2026-04-24"), createdBy: s.superadminId },
      ],
    });
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `PAY-${payment.id}` } }), 0, "seed precondition: payment is journal-less");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `HAJI-${transfer.id}` } }), 2, "seed precondition: HAJI journals exist");

    const delRes = await hardDeletePayment(
      new NextRequest(`http://localhost/api/v1/payments/${payment.id}/hard-delete`, {
        method: "DELETE", headers: authHeaders(s.superToken),
        body: JSON.stringify({ password: s.testPassword }),
      }),
      { params: { id: String(payment.id) } }
    );
    const delJson = (await delRes.json()) as any;
    assert.equal(
      delRes.status, 409,
      `hard-delete must refuse when linked HAJI journals exist, got ${delRes.status}: ${JSON.stringify(delJson)}`
    );
    assert.equal(delJson.error?.code, "PAYMENT_HAS_ACCOUNTING_HISTORY");
    assert.notEqual(await prisma.payment.findUnique({ where: { id: payment.id } }), null, "payment must survive the refused delete");
    assert.notEqual(await prisma.hajiTransfer.findUnique({ where: { id: transfer.id } }), null, "haji transfer must survive the refused delete");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `HAJI-${transfer.id}` } }), 2, "HAJI journals must survive — immutable accounting history");
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-HAJI-${transfer.id}` } }), 0, "no reversal may be created by a refused delete");
  } finally {
    await prisma.journalEntry.deleteMany({ where: { transactionId: { in: transferIds.flatMap((id) => [`HAJI-${id}`, `REV-HAJI-${id}`]) } } });
    await prisma.hajiTransfer.deleteMany({ where: { id: { in: transferIds } } });
    await cleanup({ paymentIds, expenseIds: [], depositIds: [], customerIds: [s.customer.id], lotIds: [s.lot.id], productIds: [s.product.id], bankAccountIds: [] });
    await prisma.user.update({ where: { id: s.superadminId }, data: { passwordHash: s.originalHash } });
  }
});
