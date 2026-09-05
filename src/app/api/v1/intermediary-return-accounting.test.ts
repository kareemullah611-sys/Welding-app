import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { generateToken } from "@/lib/auth";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import prisma from "@/lib/prisma";
import { getSuperAdminBankBalance } from "@/lib/settlement-validation";
import { POST as recordReturn } from "@/app/api/v1/haji-cash-receipts/route";
import { POST as reverseReturn } from "@/app/api/v1/haji-cash-receipts/[id]/reverse/route";
import { POST as recordDeposit } from "@/app/api/v1/intermediaries/[id]/deposits/route";

test("intermediary bank return updates DB journal and both balances once and reverses", async () => {
  const marker = `intermediary-return-${Date.now()}`;
  const superAdmin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  const currency = await prisma.currency.findUnique({ where: { code: "PKR" } });
  assert.ok(superAdmin && currency, "Seed superadmin and PKR currency are required");
  const token = generateToken({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const account = await prisma.superAdminBankAccount.create({
    data: { bankName: marker, currencyId: currency.id, accountKind: "bank", createdBy: superAdmin.id },
  });
  await prisma.openingSuperAdminAccountBalance.create({
    data: {
      accountId: account.id,
      currencyId: currency.id,
      amount: 1000,
      carryingAmountPkr: 1000,
      fxRateToPkr: 1,
      openingDate: new Date("2026-09-01"),
      createdBy: superAdmin.id,
    },
  });
  const intermediary = await prisma.intermediary.create({ data: { name: marker } });
  let depositId = 0;
  let receiptId = 0;

  try {
    const depositResponse = await recordDeposit(new NextRequest(`http://localhost/api/v1/intermediaries/${intermediary.id}/deposits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        depositDate: "2026-09-05",
        amount: 300,
        currencyId: currency.id,
        superAdminBankAccountId: account.id,
      }),
    }), { params: { id: String(intermediary.id) } });
    const depositJson = await depositResponse.json() as any;
    assert.equal(depositResponse.status, 201);
    depositId = depositJson.data.id;
    assert.equal((await getSuperAdminBankBalance(account.id))?.balance, 700);

    const receiptResponse = await recordReturn(new NextRequest("http://localhost/api/v1/haji-cash-receipts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        superAdminBankAccountId: account.id,
        intermediaryId: intermediary.id,
        receiptDate: "2026-09-05",
        amount: 100,
      }),
    }), { params: {} });
    const receiptJson = await receiptResponse.json() as any;
    assert.equal(receiptResponse.status, 200);
    receiptId = receiptJson.data.id;
    assert.equal((await getSuperAdminBankBalance(account.id))?.balance, 800);
    assert.equal((await getIntermediaryBalances(intermediary.id)).PKR, 200);

    const journal = await prisma.journalEntry.findMany({ where: { transactionId: `HAJIREC-${receiptId}` } });
    assert.equal(journal.length, 2);
    assert.equal(journal.reduce((sum, row) => sum + Number(row.debit), 0), 100);
    assert.equal(journal.reduce((sum, row) => sum + Number(row.credit), 0), 100);

    const reverseResponse = await reverseReturn(new NextRequest(`http://localhost/api/v1/haji-cash-receipts/${receiptId}/reverse`, {
      method: "POST",
      headers,
    }), { params: { id: String(receiptId) } });
    assert.equal(reverseResponse.status, 200);
    assert.equal((await getSuperAdminBankBalance(account.id))?.balance, 700);
    assert.equal((await getIntermediaryBalances(intermediary.id)).PKR, 300);
    assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-HAJIREC-${receiptId}` } }), 2);
  } finally {
    if (receiptId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "haji_cash_receipts", entityId: receiptId } });
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: [`HAJIREC-${receiptId}`, `REV-HAJIREC-${receiptId}`] } } });
      await prisma.hajiCashReceipt.deleteMany({ where: { id: receiptId } });
    }
    if (depositId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "intermediary_deposits", entityId: depositId } });
      await prisma.journalEntry.deleteMany({ where: { transactionId: `INTDEP-${depositId}` } });
      await prisma.intermediaryDeposit.deleteMany({ where: { id: depositId } });
    }
    await prisma.openingSuperAdminAccountBalance.deleteMany({ where: { accountId: account.id } });
    await prisma.superAdminBankAccount.deleteMany({ where: { id: account.id } });
    await prisma.intermediary.deleteMany({ where: { id: intermediary.id } });
  }
});
