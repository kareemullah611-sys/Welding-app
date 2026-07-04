import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("personal withdrawals support city bank account as a source of funds", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const route = readFileSync("src/app/api/v1/personal-withdrawals/route.ts", "utf8");
  const page = readFileSync("src/app/(dashboard)/personal-withdrawals/page.tsx", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const validations = readFileSync("src/lib/validations.ts", "utf8");

  assert.match(schema, /enum WithdrawalSourceType\s*{[^}]*bank_account/s);
  assert.match(schema, /model PersonalWithdrawal[\s\S]*bankAccountId\s+Int\?\s+@map\("bank_account_id"\)/);
  assert.match(route, /sourceType:\s*"cash_office"\s*\|\s*"bank_account"/);
  assert.match(route, /Cheque is no longer a valid withdrawal source/);
  assert.match(route, /bankAccountId/);
  assert.match(route, /Bank account is required when source is bank account/);
  assert.match(route, /journalWithdrawal\([\s\S]*bankAccountId/);
  assert.match(accounting, /sourceType\?\:\s*string\s*\|\s*null;\s*bankAccountId\?\:\s*number\s*\|\s*null/);
  assert.match(accounting, /w\.sourceType === "bank_account" && w\.bankAccountId/);
  assert.match(validations, /sourceType:\s*z\.enum\(\["cash_office", "bank_account"\]\)/);
  assert.match(page, /bankAccounts/);
  assert.match(page, /value=\{`bank_account:\$\{account\.id\}`\}/);
  assert.match(page, /sourceValue\.startsWith\("bank_account:"\)/);
  assert.doesNotMatch(page, /<option value="cheque">/);
  assert.doesNotMatch(page, /form\.sourceType === "cheque"/);
  assert.doesNotMatch(page, /<option value="bank_account">Bank Account<\/option>/);
  assert.match(page, /bankAccountId/);
});
