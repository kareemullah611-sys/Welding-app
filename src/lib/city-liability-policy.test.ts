import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const withdrawalCreate = readFileSync("src/app/api/v1/personal-withdrawals/route.ts", "utf8");
const withdrawalItem = readFileSync("src/app/api/v1/personal-withdrawals/[id]/route.ts", "utf8");
const withdrawalApproval = readFileSync("src/app/api/v1/personal-withdrawals/[id]/approve/route.ts", "utf8");
const hajiItem = readFileSync("src/app/api/v1/haji-transfers/[id]/route.ts", "utf8");
const liabilityHelper = readFileSync("src/lib/ongoing-lot-haji-owed.ts", "utf8");
const cityLedger = readFileSync("src/app/api/v1/city-ledger/route.ts", "utf8");
const cashPosition = readFileSync("src/app/api/v1/cash-position/route.ts", "utf8");
const treasury = readFileSync("src/app/api/v1/treasury/route.ts", "utf8");
const cashLedger = readFileSync("src/app/api/v1/treasury/cash-ledger/route.ts", "utf8");

test("withdrawal creation atomically creates one linked Haji transfer and accounts through it", () => {
  assert.match(withdrawalCreate, /tx\.hajiTransfer\.create\(/);
  assert.match(withdrawalCreate, /hajiTransferId:\s*createdHajiTransfer\.id/);
  assert.match(withdrawalCreate, /recordHajiTransferAccounting\(/);
  assert.doesNotMatch(withdrawalCreate, /journalWithdrawal\(/);
});

test("withdrawal approval is audit-only and creates no second money movement", () => {
  assert.doesNotMatch(withdrawalApproval, /settleForeignCurrencyOutflow\(/);
  assert.doesNotMatch(withdrawalApproval, /journalForeignWithdrawalMovements\(/);
  assert.doesNotMatch(withdrawalApproval, /journalWithdrawal\(/);
  assert.doesNotMatch(withdrawalApproval, /journalHajiTransfer\(/);
});

test("withdrawal edit and delete keep the linked Haji transfer and accounting synchronized", () => {
  assert.match(withdrawalItem, /reverseHajiTransferAccounting\(/);
  assert.match(withdrawalItem, /recordHajiTransferAccounting\(/);
  assert.match(withdrawalItem, /tx\.hajiTransfer\.update\(/);
  assert.match(withdrawalItem, /tx\.hajiTransfer\.delete\(/);
  assert.match(hajiItem, /withdrawalSource/);
  assert.match(hajiItem, /linked withdrawal/i);
});

test("city liability uses all recognized city activity and counts legacy unlinked withdrawals once", () => {
  assert.doesNotMatch(liabilityHelper, /status:\s*"ongoing"/);
  assert.doesNotMatch(liabilityHelper, /lotId:\s*\{\s*in:\s*ongoingLotIds/);
  assert.match(liabilityHelper, /personalWithdrawal\.groupBy\(/);
  assert.match(liabilityHelper, /hajiTransferId:\s*null/);
  assert.match(liabilityHelper, /openingHajiBalance\.findMany\(/);
});

test("combined ledgers and balances exclude linked Haji cash movement to prevent double deduction", () => {
  assert.match(cityLedger, /withdrawalSource/);
  assert.match(cityLedger, /isLinkedWithdrawalTransfer/);
  for (const source of [cashPosition, treasury, cashLedger]) {
    assert.match(source, /withdrawalSource:\s*null/);
  }
});
