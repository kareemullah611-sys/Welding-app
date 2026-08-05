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
  } as any;

  const result = await getSuperAdminBankBalance(7, db as any);

  assert.deepEqual(result, { balance: 410500, currencyCode: "PKR" });
});
