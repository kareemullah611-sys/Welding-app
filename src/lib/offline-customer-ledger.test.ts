import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingCustomerLedger } from "@/lib/offline-customer-ledger";

test("applies pending offline payment and sale to selected customer ledger", () => {
  const merged = applyPendingCustomerLedger(
    {
      ledger: [{ date: "2026-04-01", type: "sale", currency: "PKR", detail: "Old", debit: 1000, credit: 0, balance: 1000 }],
      balanceByCurrency: { PKR: 1000 },
    },
    [
      {
        id: "q1",
        url: "/api/v1/payments",
        method: "POST",
        body: JSON.stringify({ customerId: 10, amount: 300, paymentDate: "2026-04-02", currencyCode: "PKR" }),
      },
      {
        id: "q2",
        url: "/api/v1/sales",
        method: "POST",
        body: JSON.stringify({ customerId: 10, saleDate: "2026-04-03", items: [{ qty: 2, ratePerCarton: 250 }], currencyCode: "PKR" }),
      },
      {
        id: "q3",
        url: "/api/v1/payments",
        method: "POST",
        body: JSON.stringify({ customerId: 999, amount: 999 }),
      },
    ],
    10
  );

  assert.equal(merged.ledger?.length, 3);
  assert.equal(merged.ledger?.[0].type, "sale");
  assert.equal(merged.ledger?.[1].type, "payment");
  assert.equal(merged.balanceByCurrency?.PKR, 1200);
});

