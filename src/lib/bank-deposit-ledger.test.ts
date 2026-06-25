import test from "node:test";
import assert from "node:assert/strict";
import { formatBankDepositCashLedgerLine } from "./bank-deposit-ledger";

test("cheque withdrawal shows cheque number and bank, not slip", () => {
  const row = formatBankDepositCashLedgerLine({
    slipNumber: "DEP-42",
    cashAmount: -50000,
    cheques: [{ chequeNumber: "123456", chequeBank: "HBL" }],
  });
  assert.equal(row.type, "Cheque from Bank");
  assert.doesNotMatch(row.detail, /Slip/);
  assert.match(row.detail, /#123456 \(HBL\)/);
  assert.equal(row.reference, "123456");
});

test("cheque into bank shows slip on cash deposit row", () => {
  const row = formatBankDepositCashLedgerLine({
    slipNumber: "DEP-99",
    cashAmount: 25000,
    cheques: [{ chequeNumber: "777", chequeBank: "MCB" }],
  });
  assert.equal(row.type, "Bank Deposit");
  assert.match(row.detail, /Slip #DEP-99/);
});

test("plain bank-to-cash keeps cash wording with slip", () => {
  const row = formatBankDepositCashLedgerLine({
    slipNumber: "W-9",
    cashAmount: -10000,
    cheques: [],
  });
  assert.equal(row.type, "Cash from Bank");
  assert.match(row.detail, /Slip #W-9/);
});
