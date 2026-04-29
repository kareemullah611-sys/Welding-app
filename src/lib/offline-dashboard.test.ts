import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingDashboardMetrics } from "@/lib/offline-dashboard";

test("applies queued dashboard effects for offline posts", () => {
  const base = {
    outstandingByCurrency: { PKR: 1000 },
    hajiByCurrency: { PKR: 800 },
    totalCartonsSold: 10,
  };
  const cash = {
    incomingToHand: { opening: 100, cash: 200, cheque: 0, bankTransfer: 0, online: 0, total: 300 },
    directToHaji: 50,
    outgoing: { expenses: 20, personalWithdrawals: 30, hajiTransfers: 40, total: 90 },
    netCashInHand: 210,
  };
  const queued = [
    { url: "/api/v1/sales", method: "POST", body: JSON.stringify({ currencyCode: "PKR", items: [{ qty: 2, ratePerCarton: 100 }] }) },
    { url: "/api/v1/payments", method: "POST", body: JSON.stringify({ currencyCode: "PKR", amount: 150, destination: "our_account", paymentMethod: "cash" }) },
    { url: "/api/v1/expenses", method: "POST", body: JSON.stringify({ currencyCode: "PKR", amount: 70 }) },
    { url: "/api/v1/personal-withdrawals", method: "POST", body: JSON.stringify({ currencyCode: "PKR", amount: 20 }) },
    { url: "/api/v1/haji-transfers", method: "POST", body: JSON.stringify({ currencyCode: "PKR", amount: 10, transferType: "from_in_hand" }) },
  ];

  const merged = applyPendingDashboardMetrics(base, cash, queued);
  assert.equal(merged.data?.outstandingByCurrency?.PKR, 1050);
  assert.equal(merged.data?.hajiByCurrency?.PKR, 920);
  assert.equal(merged.data?.totalCartonsSold, 12);
  assert.equal(merged.cashPosition?.incomingToHand?.cash, 350);
  assert.equal(merged.cashPosition?.outgoing?.total, 190);
  assert.equal(merged.cashPosition?.netCashInHand, 260);
});
