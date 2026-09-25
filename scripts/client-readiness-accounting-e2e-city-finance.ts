import assert from "node:assert/strict";
import prisma from "../src/lib/prisma";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3015";
const RUN = "CR-E2E-20260925";

class Api {
  cookie = "";
  async login(username: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200, await response.text());
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  }
  async call(method: string, path: string, payload?: unknown, status?: number) {
    const response = await fetch(`${BASE_URL}${path}`, { method, headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), cookie: this.cookie }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await response.text();
    let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body?.data;
  }
}

async function balanced(transactionId: string) {
  const rows = await prisma.journalEntry.findMany({ where: { transactionId } });
  assert.ok(rows.length >= 2, `${transactionId} missing`);
  assert.equal(rows.reduce((s, row) => s + Number(row.debit), 0), rows.reduce((s, row) => s + Number(row.credit), 0), `${transactionId} unbalanced`);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname.replace(/^\//, ""), "welding_app_client_readiness_e2e_20260923");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const [city, customer, lot, pkr, sale] = await Promise.all([
    prisma.city.findFirstOrThrow({ where: { name: `${RUN} Pakistan A` } }),
    prisma.customer.findFirstOrThrow({ where: { name: `${RUN} Customer A` } }),
    prisma.lot.findFirstOrThrow({ where: { lotNumber: `${RUN}-LOT-001` } }),
    prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } }),
    prisma.sale.findFirstOrThrow({ where: { city: { name: `${RUN} Pakistan A` }, lot: { lotNumber: `${RUN}-LOT-001` }, status: "active" } }),
  ]);
  const cityApi = new Api();
  const superApi = new Api();
  await cityApi.login(`${RUN.toLowerCase()}-pk-a`, "CityAudit123");
  await superApi.login("superadmin", "admin1234");

  const cityBank = await cityApi.call("POST", "/api/v1/bank-accounts", { bankName: `${RUN} City Bank`, accountNumber: "CITY-E2E-1" }, 201);
  const superBank = await superApi.call("POST", "/api/v1/bank-accounts", { bankName: `${RUN} Super Bank`, accountNumber: "SUPER-E2E-1", currencyId: pkr.id, accountKind: "bank" }, 201);
  console.log("PASS city and superadmin bank accounts created through scoped APIs");

  const payment = await cityApi.call("POST", "/api/v1/payments", {
    customerId: customer.id, lotId: lot.id, paymentDate: "2026-09-16", detail: `${RUN} cash receipt`,
    amount: 300000, currencyId: pkr.id, paymentMethod: "cash", destination: "our_account",
  }, 201);
  await balanced(`PAY-${payment.id}`);
  console.log("PASS customer cash receipt journal");

  await cityApi.call("PUT", `/api/v1/payments/${payment.id}`, {
    paymentDate: "2026-09-17", detail: `${RUN} corrected bank receipt`, amount: 320000,
    currencyId: pkr.id, paymentMethod: "bank_transfer", destination: "our_account", bankAccountId: cityBank.id,
  });
  const editedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(Number(editedPayment.amount), 320000);
  assert.equal(editedPayment.bankAccountId, cityBank.id);
  await balanced(`PAY-${payment.id}`);
  assert.equal(await prisma.journalEntry.count({ where: { transactionId: `REV-PAY-${payment.id}` } }), 0);
  console.log("PASS payment edit replaces journal and changes cash receipt to city-bank receipt exactly once");

  await cityApi.call("PUT", `/api/v1/payments/${payment.id}/cancel`, { reason: "controlled cancellation" });
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "cancelled");
  await balanced(`REV-PAY-${payment.id}`);
  console.log("PASS payment cancellation creates balanced reversal");

  const hajiPayment = await cityApi.call("POST", "/api/v1/payments", {
    customerId: customer.id, lotId: lot.id, paymentDate: "2026-09-18", detail: `${RUN} direct haji receipt`,
    amount: 100000, currencyId: pkr.id, paymentMethod: "online", destination: "haji",
    superAdminBankAccountId: superBank.id, manualVoucherNo: "HAJI-E2E-1",
  }, 201);
  const linkedHaji = await prisma.hajiTransfer.findUniqueOrThrow({ where: { paymentId: hajiPayment.id } } as any);
  await balanced(`PAY-${hajiPayment.id}`);
  await balanced(`HAJI-${linkedHaji.id}`);
  console.log("PASS online customer payment to superadmin creates linked Haji transfer");

  await cityApi.call("PUT", `/api/v1/payments/${hajiPayment.id}`, {
    paymentDate: "2026-09-18", detail: `${RUN} moved to city bank`, amount: 100000,
    currencyId: pkr.id, paymentMethod: "online", destination: "our_account", bankAccountId: cityBank.id,
    superAdminBankAccountId: null,
  });
  assert.equal(await prisma.hajiTransfer.count({ where: { paymentId: hajiPayment.id } } as any), 0);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: hajiPayment.id } })).bankAccountId, cityBank.id);
  console.log("PASS destination edit removes the auto-created Haji transfer end to end");
  await cityApi.call("PUT", `/api/v1/payments/${hajiPayment.id}/cancel`, { reason: "controlled cancellation after destination edit" });

  const expense = await cityApi.call("POST", "/api/v1/expenses", {
    expenseDate: "2026-09-18", amount: 50000, currencyId: pkr.id,
    detail: `${RUN} office expense`, paidFrom: "cash_office",
  }, 201);
  await balanced(`EXP-${expense.id}`);
  await cityApi.call("PUT", `/api/v1/expenses/${expense.id}`, {
    expenseDate: "2026-09-19", amount: 60000, detail: `${RUN} corrected office expense`, paidFrom: "bank_account", bankAccountId: cityBank.id,
  });
  await balanced(`EXP-${expense.id}`);
  assert.equal(Number((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount), 60000);
  await cityApi.call("DELETE", `/api/v1/expenses/${expense.id}`);
  assert.ok((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).deletedAt);
  await balanced(`REV-EXP-${expense.id}`);
  console.log("PASS expense create/edit/source-change/delete restores accounting through reversal");

  const customerExpense = await cityApi.call("POST", "/api/v1/expenses", {
    expenseDate: "2026-09-19", amount: 25000, currencyId: pkr.id,
    detail: `${RUN} customer-paid expense`, paidFrom: "customer", customerId: customer.id,
  }, 201);
  let customerPaidRow = await prisma.expense.findUniqueOrThrow({ where: { id: customerExpense.id } });
  assert.ok(customerPaidRow.customerPaymentId);
  const linkedPaymentId = customerPaidRow.customerPaymentId!;
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: linkedPaymentId } })).detail, "cash- expense");
  await cityApi.call("PUT", `/api/v1/expenses/${customerExpense.id}`, {
    amount: 30000, detail: `${RUN} corrected customer-paid expense`, paidFrom: "customer", customerId: customer.id,
  });
  assert.equal(Number((await prisma.payment.findUniqueOrThrow({ where: { id: linkedPaymentId } })).amount), 30000);
  await cityApi.call("DELETE", `/api/v1/expenses/${customerExpense.id}`);
  assert.equal(await prisma.payment.count({ where: { id: linkedPaymentId } }), 0);
  console.log("PASS customer-paid expense create/edit/delete keeps paired payment synchronized and removes it on delete");

  const withdrawal = await cityApi.call("POST", "/api/v1/personal-withdrawals", {
    withdrawalDate: "2026-09-20", amount: 40000, currencyId: pkr.id,
    detail: `${RUN} cash withdrawal`, withdrawnBy: "Audit Owner", sourceType: "cash_office",
  }, 201);
  const createdWithdrawal = await prisma.personalWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
  assert.ok(createdWithdrawal.hajiTransferId);
  await balanced(`HAJI-${createdWithdrawal.hajiTransferId}`);
  await cityApi.call("PUT", `/api/v1/personal-withdrawals/${withdrawal.id}`, {
    withdrawalDate: "2026-09-21", amount: 45000, detail: `${RUN} corrected bank withdrawal`,
    withdrawnBy: "Audit Owner", sourceType: "bank_account", bankAccountId: cityBank.id,
  });
  await balanced(`HAJI-${createdWithdrawal.hajiTransferId}`);
  await cityApi.call("DELETE", `/api/v1/personal-withdrawals/${withdrawal.id}`);
  assert.equal(await prisma.personalWithdrawal.count({ where: { id: withdrawal.id } }), 0);
  assert.equal(await prisma.hajiTransfer.count({ where: { id: createdWithdrawal.hajiTransferId! } }), 0);
  await balanced(`REV-HAJI-${createdWithdrawal.hajiTransferId}`);
  console.log("PASS withdrawal create/edit cash-to-bank/delete posts once and reverses once");

  const receivable = Number(sale.totalAmount) - Number((await prisma.payment.aggregate({ where: { customerId: customer.id, status: "active" }, _sum: { amount: true } }))._sum.amount || 0);
  assert.equal(receivable, 864000);
  console.log("PASS customer receivable restored to full sale amount after all transient receipts are cancelled/deleted");

  const all = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(Number(all._sum.debit || 0), Number(all._sum.credit || 0));
  console.log(`PASS global debit/credit equality after city-finance lifecycle: ${Number(all._sum.debit || 0).toFixed(2)}`);
  console.log(`TRACE ${JSON.stringify({ cityId: city.id, customerId: customer.id, saleId: sale.id, cityBankId: cityBank.id, superBankId: superBank.id })}`);
}

main().finally(() => prisma.$disconnect());
