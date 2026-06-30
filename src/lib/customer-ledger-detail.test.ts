import test from "node:test";
import assert from "node:assert/strict";
import { formatCustomerLedgerPaymentDetail } from "@/lib/customer-ledger-detail";

test("formatCustomerLedgerPaymentDetail shows method-destination (ref)", () => {
  assert.equal(
    formatCustomerLedgerPaymentDetail({
      paymentMethod: "cash",
      destination: "our_account",
      manualVoucherNo: "879",
    }),
    "cash-office (879)",
  );
});

test("formatCustomerLedgerPaymentDetail omits empty ref", () => {
  assert.equal(
    formatCustomerLedgerPaymentDetail({
      paymentMethod: "bank_transfer",
      destination: "haji",
    }),
    "bank-transfer-haji",
  );
});
