import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOngoingLotHajiOwedByCity } from "@/lib/ongoing-lot-haji-owed";

function mockDb(input: {
  sales?: Array<{ cityId: number; currencyId: number; totalAmount: number; date?: string }>;
  expenses?: Array<{ cityId: number; currencyId: number; amount: number; date?: string }>;
  hajiTransfers?: Array<{ cityId: number; currencyId: number; amount: number; date?: string }>;
  hajiPayments?: Array<{ cityId: number; currencyId: number; amount: number; date?: string }>;
  discounts?: Array<{ cityId: number; currencyId: number; discountAmount: number; date?: string }>;
  legacyWithdrawals?: Array<{ cityId: number; currencyId: number; amount: number; date?: string }>;
  openingHaji?: Array<{
    cityId: number;
    currencyId: number;
    amount: number;
    balanceSide: "payable" | "receivable";
    openingDate: string;
  }>;
}) {
  return {
    currency: {
      findMany: async () => [{ id: 1, code: "PKR" }],
    },
    sale: {
      groupBy: async () =>
        (input.sales || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          saleDate: new Date(row.date || "2026-07-10"),
          _sum: { totalAmount: row.totalAmount },
        })),
    },
    expense: {
      groupBy: async () =>
        (input.expenses || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          expenseDate: new Date(row.date || "2026-07-10"),
          _sum: { amount: row.amount },
        })),
    },
    hajiTransfer: {
      groupBy: async () =>
        (input.hajiTransfers || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          transferDate: new Date(row.date || "2026-07-10"),
          _sum: { amount: row.amount },
        })),
    },
    payment: {
      groupBy: async () =>
        (input.hajiPayments || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          paymentDate: new Date(row.date || "2026-07-10"),
          _sum: { amount: row.amount },
        })),
    },
    personalWithdrawal: {
      groupBy: async () =>
        (input.legacyWithdrawals || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          withdrawalDate: new Date(row.date || "2026-07-10"),
          _sum: { amount: row.amount },
        })),
    },
    openingHajiBalance: {
      findMany: async () =>
        (input.openingHaji || []).map((row) => ({
          ...row,
          openingDate: new Date(row.openingDate),
        })),
    },
    saleDiscount: {
      findMany: async () =>
        (input.discounts || []).map((row) => ({
          currencyId: row.currencyId,
          discountAmount: row.discountAmount,
          discountDate: new Date(row.date || "2026-07-10"),
          sale: { cityId: row.cityId },
        })),
    },
  } as any;
}

describe("computeOngoingLotHajiOwedByCity", () => {
  it("sums city-wide revenue minus expenses, transfers, payments, discounts, and legacy withdrawals", async () => {
    const map = await computeOngoingLotHajiOwedByCity(
      mockDb({
        sales: [{ cityId: 1, currencyId: 1, totalAmount: 100000 }],
        expenses: [{ cityId: 1, currencyId: 1, amount: 10000 }],
        hajiTransfers: [{ cityId: 1, currencyId: 1, amount: 30000 }],
        hajiPayments: [{ cityId: 1, currencyId: 1, amount: 20000 }],
        discounts: [{ cityId: 1, currencyId: 1, discountAmount: 5000 }],
        legacyWithdrawals: [{ cityId: 1, currencyId: 1, amount: 4000 }],
      })
    );
    assert.deepEqual(map.get(1), { PKR: 31000 });
  });

  it("returns an empty map when the city has no liability activity", async () => {
    const map = await computeOngoingLotHajiOwedByCity(mockDb({}));
    assert.equal(map.size, 0);
  });

  it("uses an opening Haji balance as the cutover and excludes earlier activity", async () => {
    const map = await computeOngoingLotHajiOwedByCity(
      mockDb({
        sales: [
          { cityId: 1, currencyId: 1, totalAmount: 250000, date: "2026-07-05" },
          { cityId: 1, currencyId: 1, totalAmount: 100000, date: "2026-07-06" },
        ],
        expenses: [
          { cityId: 1, currencyId: 1, amount: 50000, date: "2026-07-05" },
          { cityId: 1, currencyId: 1, amount: 10000, date: "2026-07-06" },
        ],
        hajiTransfers: [
          { cityId: 1, currencyId: 1, amount: 40000, date: "2026-07-05" },
          { cityId: 1, currencyId: 1, amount: 30000, date: "2026-07-07" },
        ],
        hajiPayments: [
          { cityId: 1, currencyId: 1, amount: 30000, date: "2026-07-05" },
          { cityId: 1, currencyId: 1, amount: 20000, date: "2026-07-08" },
        ],
        discounts: [
          { cityId: 1, currencyId: 1, discountAmount: 20000, date: "2026-07-05" },
          { cityId: 1, currencyId: 1, discountAmount: 5000, date: "2026-07-09" },
        ],
        openingHaji: [
          {
            cityId: 1,
            currencyId: 1,
            amount: 114000,
            balanceSide: "payable",
            openingDate: "2026-07-06",
          },
        ],
      })
    );

    assert.deepEqual(map.get(1), { PKR: 149000 });
  });
});
