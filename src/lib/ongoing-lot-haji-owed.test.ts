import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOngoingLotHajiOwedByCity } from "@/lib/ongoing-lot-haji-owed";

function mockDb(input: {
  ongoingLotIds?: number[];
  sales?: Array<{ cityId: number; currencyId: number; totalAmount: number }>;
  expenses?: Array<{ cityId: number; currencyId: number; amount: number }>;
  hajiTransfers?: Array<{ cityId: number; currencyId: number; amount: number }>;
  hajiPayments?: Array<{ cityId: number; currencyId: number; amount: number }>;
  discounts?: Array<{ cityId: number; currencyId: number; discountAmount: number }>;
}) {
  const ongoingLotIds = input.ongoingLotIds ?? [10];
  return {
    currency: {
      findMany: async () => [{ id: 1, code: "PKR" }],
    },
    lot: {
      findMany: async () => ongoingLotIds.map((id) => ({ id, lotCityDistributions: [{ cityId: 1 }] })),
    },
    sale: {
      groupBy: async () =>
        (input.sales || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          _sum: { totalAmount: row.totalAmount },
        })),
    },
    expense: {
      groupBy: async () =>
        (input.expenses || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          _sum: { amount: row.amount },
        })),
    },
    hajiTransfer: {
      groupBy: async () =>
        (input.hajiTransfers || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          _sum: { amount: row.amount },
        })),
    },
    payment: {
      groupBy: async () =>
        (input.hajiPayments || []).map((row) => ({
          cityId: row.cityId,
          currencyId: row.currencyId,
          _sum: { amount: row.amount },
        })),
    },
    lotSettlementOverflow: {
      groupBy: async () => [],
    },
    saleDiscount: {
      findMany: async () =>
        (input.discounts || []).map((row) => ({
          currencyId: row.currencyId,
          discountAmount: row.discountAmount,
          sale: { cityId: row.cityId },
        })),
    },
  } as any;
}

describe("computeOngoingLotHajiOwedByCity", () => {
  it("sums sales minus expenses, transfers, payments, and discounts on ongoing lots", async () => {
    const map = await computeOngoingLotHajiOwedByCity(
      mockDb({
        sales: [{ cityId: 1, currencyId: 1, totalAmount: 100000 }],
        expenses: [{ cityId: 1, currencyId: 1, amount: 10000 }],
        hajiTransfers: [{ cityId: 1, currencyId: 1, amount: 30000 }],
        hajiPayments: [{ cityId: 1, currencyId: 1, amount: 20000 }],
        discounts: [{ cityId: 1, currencyId: 1, discountAmount: 5000 }],
      })
    );
    assert.deepEqual(map.get(1), { PKR: 35000 });
  });

  it("returns empty map when no ongoing lots exist", async () => {
    const map = await computeOngoingLotHajiOwedByCity(mockDb({ ongoingLotIds: [] }));
    assert.equal(map.size, 0);
  });
});
