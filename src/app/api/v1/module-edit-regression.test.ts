import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("expense withdrawal and haji edit forms preserve creation source fields", () => {
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const expenseRoute = readFileSync("src/app/api/v1/expenses/[id]/route.ts", "utf8");
  const withdrawalRoute = readFileSync("src/app/api/v1/personal-withdrawals/[id]/route.ts", "utf8");
  const hajiRoute = readFileSync("src/app/api/v1/haji-transfers/[id]/route.ts", "utf8");
  const expensesPage = readFileSync("src/app/(dashboard)/expenses/page.tsx", "utf8");
  const withdrawalsPage = readFileSync("src/app/(dashboard)/personal-withdrawals/page.tsx", "utf8");
  const hajiPage = readFileSync("src/app/(dashboard)/haji-transfers/page.tsx", "utf8");

  assert.match(validations, /expenseDate:\s*z\.string\(\)\.optional\(\)/);
  assert.match(validations, /paidFrom:\s*z\.enum\(\["cash_office", "bank_account", "cheque", "customer"\]\)\.optional\(\)/);
  assert.match(validations, /export const updateWithdrawalSchema/);

  assert.match(expenseRoute, /nextExpenseDate/);
  assert.match(expenseRoute, /nextPaidFrom/);
  assert.match(expenseRoute, /journalExpenseCreated\(\{/);
  assert.match(withdrawalRoute, /updateWithdrawalSchema\.safeParse/);
  assert.match(withdrawalRoute, /nextWithdrawalDate/);
  assert.match(withdrawalRoute, /sourceType:\s*nextSourceType/);
  assert.match(hajiRoute, /nextTransferDate/);
  assert.match(hajiRoute, /sourceType:\s*nextSourceType/);
  assert.match(hajiRoute, /bankAccountId:\s*nextBankAccountId/);

  assert.match(expensesPage, /expenseDate:\s*form\.expenseDate/);
  assert.match(expensesPage, /handleExpenseFromChange\(e\.target\.value\)/);
  assert.match(withdrawalsPage, /withdrawalDate:\s*form\.withdrawalDate/);
  assert.match(withdrawalsPage, /sourceType:\s*form\.sourceType/);
  assert.match(hajiPage, /transferDate:\s*form\.transferDate/);
  assert.match(hajiPage, /sourceType:\s*form\.sourceType/);
});

test("customer-paid expenses create and sync linked customer payments", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const expenseCreateRoute = readFileSync("src/app/api/v1/expenses/route.ts", "utf8");
  const expenseEditRoute = readFileSync("src/app/api/v1/expenses/[id]/route.ts", "utf8");
  const customerRoute = readFileSync("src/app/api/v1/customers/[id]/route.ts", "utf8");
  const paymentsPage = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(schema, /customerPaymentId Int\?\s+@unique @map\("customer_payment_id"\)/);
  assert.match(schema, /customerPayment Payment\?\s+@relation\("ExpenseCustomerPayment"/);
  assert.match(validations, /customerId:\s*optionalPositiveInt/);

  assert.match(expenseCreateRoute, /paidFrom === "customer" && !customerId/);
  assert.match(expenseCreateRoute, /tx\.payment\.create\(\{/);
  assert.match(expenseCreateRoute, /detail:\s*"cash- expense"/);
  assert.match(expenseCreateRoute, /journalPaymentReceived\(\{/);
  assert.match(expenseCreateRoute, /customerPaymentId/);

  assert.match(expenseEditRoute, /nextPaidFrom === "customer"/);
  assert.match(expenseEditRoute, /tx\.payment\.update\(/);
  assert.match(expenseEditRoute, /tx\.payment\.create\(/);
  assert.match(expenseEditRoute, /detail:\s*"cash- expense"/);
  assert.match(expenseEditRoute, /tx\.payment\.delete\(\{ where: \{ id: linkedCustomerPayment\.id \} \}\)/);
  assert.match(customerRoute, /customerPaidExpense: \{ select: \{ id: true \} \}/);
  assert.match(customerRoute, /\? "cash- expense"/);

  assert.match(paymentsPage, /form\.paidFrom === "customer"/);
  assert.match(paymentsPage, /CustomerFieldWithNew/);
  assert.match(paymentsPage, /customerId:\s*form\.paidFrom === "customer" \? form\.customerId : undefined/);
});
