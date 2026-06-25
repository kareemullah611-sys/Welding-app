import assert from "node:assert/strict";
import test from "node:test";

import { getCityBankAccountAvailableBalance } from "@/lib/city-bank-balance";

test("getCityBankAccountAvailableBalance sums inflows and subtracts outflows", async () => {
  const db = {
    openingBankBalance: { aggregate: async () => ({ _sum: { amount: 1000 } }) },
    payment: {
      aggregate: async (args: any) => {
        if (args?.where?.paymentMethod?.in) return { _sum: { amount: 5000 } };
        if (args?.where?.paymentMethod === "cheque") return { _sum: { amount: 2000 } };
        return { _sum: { amount: 0 } };
      },
    },
    bankDeposit: {
      aggregate: async () => ({ _sum: { cashAmount: -1500 } }),
      findMany: async () => [{ id: 10 }],
    },
    hajiTransfer: { aggregate: async () => ({ _sum: { amount: 800 } }) },
    expense: { aggregate: async () => ({ _sum: { amount: 200 } }) },
    currency: { findUnique: async () => ({ code: "PKR" }) },
    supplierPayment: {
      findMany: async () => [{ amountLocal: 300, amountUsd: 0, exchangeRate: 0 }],
    },
  } as any;

  const balance = await getCityBankAccountAvailableBalance(db, {
    cityId: 1,
    bankAccountId: 5,
    currencyId: 1,
  });

  // 1000 + 5000 + (-1500) + 2000 - 800 - 200 - 300 = 5200
  assert.equal(balance, 5200);
});
