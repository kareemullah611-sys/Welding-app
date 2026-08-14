import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPaymentSubmitPayload } from "@/lib/payment-module-detail";
import { updatePaymentSchema } from "@/lib/validations";

test("payment edit supports creation fields and reposts journals for accounting changes", () => {
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const route = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");
  const page = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  assert.match(validations, /paymentMethod:\s*z\.enum\(\["cash", "cheque", "bank_transfer", "online"\]\)\.optional\(\)/);
  assert.match(validations, /manualVoucherNo:\s*z\.string\(\)\.max\(50\)\.optional\(\)\.nullable\(\)/);
  assert.match(validations, /bankAccountId:\s*optionalPositiveInt/);
  assert.match(validations, /superAdminBankAccountId:\s*optionalPositiveInt/);

  assert.match(route, /const accountingChanged =/);
  assert.match(route, /if \(accountingChanged\)/);
  assert.match(route, /journalFn\(\{/);
  assert.match(route, /paymentMethod:\s*nextPaymentMethod/);
  assert.match(route, /bankAccountId:\s*nextBankAccountId/);
  assert.match(route, /superAdminBankAccountId:\s*nextSuperAdminBankAccountId/);

  assert.match(page, /paymentMethod:\s*raw\.paymentMethod \|\| "cash"/);
  assert.match(page, /manualVoucherNo:\s*raw\.manualVoucherNo \|\| ""/);
  assert.match(page, /buildPaymentSubmitPayload\(paymentForm/);
  assert.match(page, /t\("payment_method"\)/);
  assert.match(page, /getPakistanPaymentAccountSelectValue\(form\)/);
  assert.match(route, /else if \(linkedHajiTransfer\)/);
  assert.match(route, /tx\.hajiTransfer\.delete\(\{ where: \{ id: linkedHajiTransfer\.id \} \}\)/);
});

test("payment edit treats zero account ids as unselected", () => {
  const payload = buildPaymentSubmitPayload({
    paymentMethod: "online",
    destination: "haji",
    bankAccountId: 292,
    superAdminBankAccountId: 0,
  }, {
    currencyId: 1,
    cityBankAccounts: [{ id: 292, bankName: "City Bank", accountNumber: "123" }],
    superAdminBankAccounts: [{ id: 99, bankName: "Super Bank", accountNumber: "999" }],
  });

  const parsed = updatePaymentSchema.safeParse({
    ...payload,
    superAdminBankAccountId: 0,
  });

  assert.equal(parsed.success, true);
  assert.equal(payload.destination, "our_account");
  assert.equal(parsed.data.bankAccountId, 292);
  assert.equal(parsed.data.superAdminBankAccountId, undefined);
});

test("payment edit prefill submits raw ISO dates instead of display dates", () => {
  const page = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const route = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");

  assert.match(page, /function normalizeEditDate/);
  assert.match(page, /paymentDate:\s*normalizeEditDate\(raw\.paymentDate, item\.date\)/);
  assert.doesNotMatch(page, /paymentDate:\s*item\.date \|\| String\(raw\.paymentDate/);
  assert.match(page, /transferDate:\s*normalizeEditDate\(raw\.transferDate, item\.date\)/);
  assert.match(page, /expenseDate:\s*normalizeEditDate\(raw\.expenseDate, item\.date\)/);
  assert.match(page, /withdrawalDate:\s*normalizeEditDate\(raw\.withdrawalDate, item\.date\)/);
  assert.match(route, /function parsePaymentEditDate/);
  assert.ok(route.includes("const display = raw.match(/^(\\d{2})-(\\d{2})-(\\d{2})$/);"));
  assert.match(route, /new Date\(`20\$\{display\[3\]\}-\$\{display\[2\]\}-\$\{display\[1\]\}`\)/);
  assert.match(route, /const nextPaymentDate = parsePaymentEditDate\(data\.paymentDate, payment\.paymentDate\)/);
});
