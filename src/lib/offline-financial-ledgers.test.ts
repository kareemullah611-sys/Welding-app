import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingPayablesReport, applyPendingReceivablesReport } from "@/lib/offline-financial-ledgers";

test("applies pending receivables from queued sales and payments", () => {
  const merged = applyPendingReceivablesReport(
    { totalByCurrency: { PKR: 1000 }, customers: [{ account: "AR - Existing", currency: "PKR", balance: 1000 }] },
    [
      { url: "/api/v1/sales", method: "POST", body: JSON.stringify({ customerName: "Walk-in", currencyCode: "PKR", items: [{ qty: 2, ratePerCarton: 100 }] }) },
      { url: "/api/v1/payments", method: "POST", body: JSON.stringify({ customerName: "Walk-in", currencyCode: "PKR", amount: 50 }) },
    ]
  );
  assert.equal(merged?.totalByCurrency?.PKR, 1150);
});

test("applies pending payables without classifying intermediary openings as liabilities", () => {
  const merged = applyPendingPayablesReport(
    {
      suppliers: [{ account: "Main Supplier", currency: "USD", balance: 500 }],
      agents: [],
      shippingLines: [],
      intermediaries: [],
    },
    [
      { url: "/api/v1/lot-purchases", method: "POST", body: JSON.stringify({ supplierName: "Main Supplier", totalPriceUsd: 200 }) },
      { url: "/api/v1/supplier-payments", method: "POST", body: JSON.stringify({ supplierName: "Main Supplier", amountUsd: 80 }) },
      { url: "/api/v1/agent-payments", method: "POST", body: JSON.stringify({ agentName: "Agent A", amount: 30, currencyCode: "USD" }) },
      { url: "/api/v1/shipping-line-payments", method: "POST", body: JSON.stringify({ shippingLineName: "SL-1", amountUsd: 50 }) },
      { url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "liability", liabilityType: "supplier", partyName: "Main Supplier", amount: 40, currencyCode: "USD" }) },
      { url: "/api/v1/openings", method: "POST", body: JSON.stringify({ kind: "liability", liabilityType: "intermediary", partyName: "Intermediary A", amount: 25, currencyCode: "PKR" }) },
    ]
  );
  const supplier = merged?.suppliers?.find((s) => s.account === "Main Supplier" && s.currency === "USD");
  const agent = merged?.agents?.find((s) => s.account === "Agent A");
  const shipping = merged?.shippingLines?.find((s) => s.account === "SL-1");
  const intermediary = merged?.intermediaries?.find((s) => s.account === "Intermediary A");
  assert.equal(supplier?.balance, 660);
  assert.equal(agent?.balance, -30);
  assert.equal(shipping?.balance, -50);
  assert.equal(intermediary, undefined);
});
