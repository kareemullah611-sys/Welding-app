import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createExpenseSchema, createPaymentSchema } from "@/lib/validations";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("seed and setup files do not publish hardcoded default passwords", () => {
  const files = ["prisma/seed.ts", "scripts/setup-offline.sh", "README.md"];
  const violations: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const password of ["admin123", "city123"]) {
      if (content.includes(password)) violations.push(`${file}: contains ${password}`);
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("payment create schema validates all payment source fields", () => {
  const parsed = createPaymentSchema.parse({
    customerId: 1,
    paymentDate: "2026-07-03",
    detail: "Receipt",
    amount: 100,
    paymentMethod: "bank_transfer",
    destination: "our_account",
    chequeNumber: "CHQ-1",
    chequeBank: "Bank",
    chequeDueDate: "2026-07-10",
    bankAccountId: 7,
    superAdminBankAccountId: null,
  });

  assert.equal(parsed.chequeNumber, "CHQ-1");
  assert.equal(parsed.chequeBank, "Bank");
  assert.equal(parsed.chequeDueDate, "2026-07-10");
  assert.equal(parsed.bankAccountId, 7);
  assert.equal(parsed.superAdminBankAccountId, null);
});

test("payment create schema allows negative customer return amounts but rejects zero", () => {
  const parsed = createPaymentSchema.parse({
    customerId: 1,
    paymentDate: "2026-07-20",
    detail: "Return to customer",
    amount: -9000,
    paymentMethod: "cash",
    destination: "our_account",
  });

  assert.equal(parsed.amount, -9000);
  assert.equal(createPaymentSchema.safeParse({
    customerId: 1,
    paymentDate: "2026-07-20",
    detail: "Zero payment",
    amount: 0,
    paymentMethod: "cash",
    destination: "our_account",
  }).success, false);
});

test("expense create schema validates all payment source fields", () => {
  const parsed = createExpenseSchema.parse({
    expenseDate: "2026-07-03",
    amount: 100,
    detail: "Freight",
    paidFrom: "cheque",
    bankAccountId: null,
    chequePaymentId: 9,
  });

  assert.equal(parsed.paidFrom, "cheque");
  assert.equal(parsed.bankAccountId, null);
  assert.equal(parsed.chequePaymentId, 9);
});

test("login rate limiting is not bypassable by spoofed forwarded IP alone", () => {
  const loginRoute = fs.readFileSync(path.join(ROOT, "src/app/api/v1/auth/login/route.ts"), "utf8");

  assert.match(loginRoute, /getClientIP\(request\)/);
  assert.match(loginRoute, /login-user:\$\{username\.toLowerCase\(\)\}/);
  assert.doesNotMatch(loginRoute, /x-forwarded-for"\)\?\.split\(","\)/);
});

test("admin cleanup route does not expose raw schema migration SQL", () => {
  const cleanupRoute = fs.readFileSync(path.join(ROOT, "src/app/api/v1/admin-cleanup/route.ts"), "utf8");

  assert.doesNotMatch(cleanupRoute, /\$executeRawUnsafe/);
  assert.doesNotMatch(cleanupRoute, /runDevMigration/);
  assert.doesNotMatch(cleanupRoute, /body\.action === "migrate"/);
});

test("assistant requires explicit opt-in before sending live financial context externally", () => {
  const assistantRoute = fs.readFileSync(path.join(ROOT, "src/app/api/v1/assistant/route.ts"), "utf8");

  assert.match(assistantRoute, /ASSISTANT_ALLOW_EXTERNAL_FINANCIAL_DATA/);
  assert.match(assistantRoute, /shouldShareAssistantFinancialContext/);
  assert.match(assistantRoute, /Live financial database context is disabled/);
});

test("password changes rotate the current token and revoke prior sessions", () => {
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/v1/auth/change-password/route.ts"), "utf8");

  assert.match(route, /generateToken/);
  assert.match(route, /userSession\.create/);
  assert.match(route, /tokenHash: hashToken\(newToken\)/);
  assert.match(route, /userSession\.updateMany\(\{\s*where: \{\s*userId: payload\.userId,\s*isActive: true,\s*\}/s);
  assert.doesNotMatch(route, /NOT: \{ tokenHash: hashToken\(token\) \}/);
});
