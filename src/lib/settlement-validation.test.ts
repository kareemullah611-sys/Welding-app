import assert from "node:assert/strict";
import test from "node:test";

import { getSuperAdminBankBalance } from "@/lib/settlement-validation";

test("getSuperAdminBankBalance counts haji transfers as incoming funds", async () => {
  const db = {
    superAdminBankAccount: {
      findUnique: async () => ({
        id: 7,
        currencyId: 1,
        currency: { code: "PKR" },
        isActive: true,
      }),
    },
    payment: {
      groupBy: async () => [],
    },
    superAdminPersonalExpense: {
      aggregate: async () => ({ _sum: { amount: 0 } }),
    },
    intermediaryDeposit: {
      aggregate: async () => ({ _sum: { amount: 0 } }),
    },
    lotCost: {
      findMany: async () => [],
    },
    supplierPayment: {
      findMany: async () => [],
    },
    hajiTransfer: {
      aggregate: async () => ({ _sum: { amount: 410500 } }),
    },
    openingSuperAdminAccountBalance: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    hajiCashReceipt: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    agentPayment: { findMany: async () => [] },
    shippingLinePayment: { findMany: async () => [] },
    investmentParticipantSettlementPayment: { aggregate: async () => ({ _sum: { paymentAmount: 0 } }) },
    superAdminAccountTransfer: { aggregate: async () => ({ _sum: { fromAmount: 0, toAmount: 0 } }) },
    superAdminLiabilityEntry: { aggregate: async () => ({ _sum: { liabilityEffect: 0 } }) },
  } as any;

  const result = await getSuperAdminBankBalance(7, db as any);

  assert.deepEqual(result, { balance: 410500, currencyCode: "PKR" });
});

test("getSuperAdminBankBalance reconciles all superadmin treasury movements", async () => {
  const transferAggregates = [
    { _sum: { toAmount: 200 } },
    { _sum: { fromAmount: 50 } },
  ];
  const db = {
    superAdminBankAccount: { findUnique: async () => ({ id: 7, currencyId: 1, currency: { code: "PKR" }, isActive: true }) },
    openingSuperAdminAccountBalance: { aggregate: async () => ({ _sum: { amount: 1000 } }) },
    payment: { groupBy: async () => [{ _sum: { amount: 500 } }] },
    hajiTransfer: { aggregate: async () => ({ _sum: { amount: 100 } }) },
    hajiCashReceipt: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    superAdminPersonalExpense: { aggregate: async () => ({ _sum: { amount: 50 } }) },
    intermediaryDeposit: { aggregate: async () => ({ _sum: { amount: 100 } }) },
    lotCost: { findMany: async () => [{ amount: 25 }] },
    supplierPayment: { findMany: async () => [{ amountLocal: 100, amountUsd: 0 }] },
    agentPayment: { findMany: async () => [{ amount: 30 }] },
    shippingLinePayment: { findMany: async () => [{ amountPkr: 40, amountUsd: 0 }] },
    investmentParticipantSettlementPayment: { aggregate: async () => ({ _sum: { paymentAmount: 10 } }) },
    superAdminAccountTransfer: { aggregate: async () => transferAggregates.shift() },
    superAdminLiabilityEntry: { aggregate: async () => ({ _sum: { liabilityEffect: 225 } }) },
  } as any;

  const result = await getSuperAdminBankBalance(7, db);

  assert.deepEqual(result, { balance: 1620, currencyCode: "PKR" });
});
