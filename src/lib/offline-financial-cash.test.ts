import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingFinancialCashReport } from "@/lib/offline-financial-cash";

test("applies pending queue effects to cash report positions", () => {
  const merged = applyPendingFinancialCashReport(
    {
      cashPositions: [{ account: "Cash in Hand", currency: "PKR", balance: 1000 }],
      bankPositions: [{ account: "HBL", currency: "PKR", balance: 2000 }],
      intermediaryPositions: [],
    },
    [
      { url: "/api/v1/payments", method: "POST", body: JSON.stringify({ amount: 200, destination: "our_account", paymentMethod: "cash", currencyCode: "PKR" }) },
      { url: "/api/v1/expenses", method: "POST", body: JSON.stringify({ amount: 100, paidFrom: "cash_office", currencyCode: "PKR" }) },
      { url: "/api/v1/personal-withdrawals", method: "POST", body: JSON.stringify({ amount: 50, sourceType: "cash_office", currencyCode: "PKR" }) },
      { url: "/api/v1/haji-transfers", method: "POST", body: JSON.stringify({ amount: 40, sourceType: "bank_transfer", bankAccountId: 5, currencyCode: "PKR" }) },
      { url: "/api/v1/bank-deposits", method: "POST", body: JSON.stringify({ cashAmount: 25, chequeAmount: 25, bankAccountId: 5, currencyCode: "PKR" }) },
    ]
  );

  const pendingCash = merged?.cashPositions?.find((entry) => entry.account === "Offline Pending Cash/Cheque" && entry.currency === "PKR");
  const pendingBank = merged?.bankPositions?.find((entry) => entry.account === "Offline Pending Bank #5" && entry.currency === "PKR");

  assert.equal(pendingCash?.balance, 0); // +200 -100 -50 -50
  assert.equal(pendingBank?.balance, 10); // -40 +50
});

