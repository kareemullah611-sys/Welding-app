import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCustomerLedgerPaymentDetail,
  formatCustomerLedgerSaleDetail,
  formatCustomerLedgerSaleRate,
} from "@/lib/customer-ledger-detail";

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

test("formatCustomerLedgerPaymentDetail shows account before online transfer method", () => {
  assert.equal(
    formatCustomerLedgerPaymentDetail({
      paymentMethod: "online",
      destination: "our_account",
      manualVoucherNo: "5521",
      bankAccount: { bankName: "Malik Mzn", accountNumber: "8235" },
    }),
    "Malik Mzn-8235-online (5521)",
  );
});

test("formatCustomerLedgerSaleDetail shows complete item quantities with @ carton rates", () => {
  assert.equal(
    formatCustomerLedgerSaleDetail([
      { product: { name: "4.0mm" }, qty: 20, ratePerCarton: 23600 },
      { product: { name: "3.2mm" }, qty: 20, ratePerCarton: 23600 },
      { product: { name: "5.0mm" }, cartonQty: 4, qty: 200, ratePerCarton: 25000 },
    ]),
    "4.0mm × 20 @ 23,600, 3.2mm × 20 @ 23,600, 5.0mm × 4 @ 25,000",
  );
});

test("formatCustomerLedgerSaleRate prefixes per-carton rates with @", () => {
  assert.equal(
    formatCustomerLedgerSaleRate([
      { product: { name: "4.0mm" }, qty: 20, ratePerCarton: 23600 },
      { product: { name: "5.0mm" }, qty: 4, ratePerCarton: 25000 },
    ]),
    "@ 23,600 - 25,000",
  );
});
