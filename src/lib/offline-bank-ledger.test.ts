import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingBankLedger } from "@/lib/offline-bank-ledger";

test("applies pending bank-affecting queued entries for selected account", () => {
  const result = applyPendingBankLedger(
    [{ date: "2026-04-01", type: "Opening", detail: "Opening", credit: 1000 }],
    { PKR: 1000 },
    [
      { id: "1", url: "/api/v1/payments", method: "POST", body: JSON.stringify({ paymentMethod: "bank_transfer", destination: "our_account", bankAccountId: 5, amount: 400, currencyCode: "PKR", paymentDate: "2026-04-02" }) },
      { id: "2", url: "/api/v1/expenses", method: "POST", body: JSON.stringify({ paidFrom: "bank_account", bankAccountId: 5, amount: 120, currencyCode: "PKR", expenseDate: "2026-04-03" }) },
      { id: "3", url: "/api/v1/haji-transfers", method: "POST", body: JSON.stringify({ sourceType: "bank_transfer", bankAccountId: 5, amount: 80, currencyCode: "PKR", date: "2026-04-04" }) },
      { id: "4", url: "/api/v1/bank-deposits", method: "POST", body: JSON.stringify({ bankAccountId: 5, cashAmount: 50, chequeAmount: 50, currencyCode: "PKR", depositDate: "2026-04-05" }) },
      { id: "9", url: "/api/v1/payments", method: "POST", body: JSON.stringify({ paymentMethod: "bank_transfer", destination: "our_account", bankAccountId: 99, amount: 999 }) },
    ],
    5
  );

  assert.equal(result.rows.filter((r) => r._pending).length, 4);
  assert.equal(result.balanceByCurrency.PKR, 1300);
});
