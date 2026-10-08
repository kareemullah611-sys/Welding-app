import test from "node:test";
import assert from "node:assert/strict";

import { applyPendingDashboardMetrics } from "@/lib/offline-dashboard";

function baseCash() {
  return {
    incomingToHand: { opening: 0, cash: 1000, cheque: 0, bankTransfer: 0, online: 0, total: 1000 },
    directToHaji: 0,
    outgoing: { expenses: 0, personalWithdrawals: 0, hajiTransfers: 0, total: 0 },
    netCashInHand: 1000,
  } as any;
}

function queued(url: string, body: Record<string, unknown>) {
  return { url, method: "POST", body: JSON.stringify(body) };
}

test("queued cash-to-bank deposit removes cash from hand", () => {
  const result = applyPendingDashboardMetrics(
    null,
    baseCash(),
    [queued("/api/v1/bank-deposits", { transferType: "cheque_to_bank", cashAmount: 400, currencyCode: "PKR" })]
  );

  assert.equal(result.cashPosition!.netCashInHand, 600);
  assert.equal(result.cashPosition!.incomingToHand!.cash, 600);
});

test("queued bank-to-cash deposit adds cash to hand", () => {
  const result = applyPendingDashboardMetrics(
    null,
    baseCash(),
    [queued("/api/v1/bank-deposits", { transferType: "bank_to_cash", cashAmount: 250, currencyCode: "PKR" })]
  );

  assert.equal(result.cashPosition!.netCashInHand, 1250);
});

test("queued bank-to-bank deposit does not change cash in hand", () => {
  const result = applyPendingDashboardMetrics(
    null,
    baseCash(),
    [queued("/api/v1/bank-deposits", { transferType: "bank_to_bank", cashAmount: 900, currencyCode: "PKR" })]
  );

  assert.equal(result.cashPosition!.netCashInHand, 1000);
});

test("queued deposit keeps outgoing total consistent with net cash", () => {
  const result = applyPendingDashboardMetrics(
    null,
    baseCash(),
    [queued("/api/v1/bank-deposits", { transferType: "cheque_to_bank", cashAmount: 400, currencyCode: "PKR" })]
  );

  const cp = result.cashPosition!;
  const incomingTotal = Number(cp.incomingToHand?.total ?? 0);
  const outgoingTotal = Number(cp.outgoing?.total ?? 0);
  assert.equal(
    incomingTotal - outgoingTotal,
    Number(cp.netCashInHand ?? 0),
    "netCashInHand must stay reconcilable with incoming minus outgoing"
  );
});
