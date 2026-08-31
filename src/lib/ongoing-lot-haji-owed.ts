import prisma from "@/lib/prisma";
import { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const ACTIVE_SALE_STATUSES = ["active", "marked_short"] as const;

export function openingHajiOwedDelta(amount: number, balanceSide: "payable" | "receivable") {
  return balanceSide === "payable" ? amount : -amount;
}

/** Net unsettled owed to Haji from ongoing lots only (per city, per currency code). */
export async function computeOngoingLotHajiOwedByCity(
  db: Db = prisma,
  options: { cityId?: number } = {}
): Promise<Map<number, Record<string, number>>> {
  const currencies = await db.currency.findMany({ select: { id: true, code: true } });
  const currCode = Object.fromEntries(currencies.map((c) => [c.id, c.code]));

  const ongoingLots = await db.lot.findMany({
    where: { status: "ongoing" },
    select: { id: true, lotCityDistributions: { select: { cityId: true } } },
  });
  const ongoingLotIds = ongoingLots.map((l) => l.id);
  const result = new Map<number, Record<string, number>>();
  if (!ongoingLotIds.length) return result;

  const cityFilter = options.cityId ? { cityId: options.cityId } : {};
  const lotFilter = { lotId: { in: ongoingLotIds } };

  const [sales, expenses, hajiTransfers, hajiPayments, overflowCredits, openingHaji] = await Promise.all([
    db.sale.groupBy({
      by: ["cityId", "currencyId", "saleDate"],
      where: { ...cityFilter, ...lotFilter, status: { in: [...ACTIVE_SALE_STATUSES] } },
      _sum: { totalAmount: true },
    }),
    db.expense.groupBy({
      by: ["cityId", "currencyId", "expenseDate"],
      where: { ...cityFilter, ...lotFilter, deletedAt: null },
      _sum: { amount: true },
    }),
    db.hajiTransfer.groupBy({
      by: ["cityId", "currencyId", "transferDate"],
      where: { ...cityFilter, ...lotFilter, paymentId: null },
      _sum: { amount: true },
    }),
    db.payment.groupBy({
      by: ["cityId", "currencyId", "paymentDate"],
      where: { ...cityFilter, ...lotFilter, status: "active", destination: "haji" },
      _sum: { amount: true },
    }),
    db.lotSettlementOverflow.groupBy({
      by: ["cityId", "currencyId", "createdAt"],
      where: {
        ...cityFilter,
        toLotId: { in: ongoingLotIds },
      },
      _sum: { overflowAmount: true },
    }),
    db.openingHajiBalance.findMany({
      where: cityFilter,
      select: {
        cityId: true,
        currencyId: true,
        amount: true,
        balanceSide: true,
        openingDate: true,
      },
    }),
  ]);

  const openingCutoffs = new Map(
    openingHaji.map((row) => [`${row.cityId}:${row.currencyId}`, row.openingDate.getTime()])
  );
  const isAfterOpening = (cityId: number, currencyId: number, activityDate: Date) => {
    const cutoff = openingCutoffs.get(`${cityId}:${currencyId}`);
    return cutoff === undefined || activityDate.getTime() >= cutoff;
  };

  const add = (cityId: number, currencyId: number, delta: number) => {
    if (!cityId || !currencyId) return;
    const code = currCode[currencyId] || `CUR${currencyId}`;
    const bucket = result.get(cityId) || {};
    bucket[code] = round2((bucket[code] || 0) + delta);
    result.set(cityId, bucket);
  };

  for (const row of sales) {
    if (!isAfterOpening(row.cityId, row.currencyId, row.saleDate)) continue;
    add(row.cityId, row.currencyId, Number(row._sum.totalAmount || 0));
  }
  for (const row of expenses) {
    if (!isAfterOpening(row.cityId, row.currencyId, row.expenseDate)) continue;
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of hajiTransfers) {
    if (!isAfterOpening(row.cityId, row.currencyId, row.transferDate)) continue;
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of hajiPayments) {
    if (!isAfterOpening(row.cityId, row.currencyId, row.paymentDate)) continue;
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of overflowCredits) {
    if (!isAfterOpening(row.cityId, row.currencyId, row.createdAt)) continue;
    // Overflow credits into ongoing lots are not real remittances — add back
    add(row.cityId, row.currencyId, Number(row._sum.overflowAmount || 0));
  }
  for (const row of openingHaji) {
    add(row.cityId, row.currencyId, openingHajiOwedDelta(Number(row.amount || 0), row.balanceSide));
  }

  // Discounts: need cityId from sale join
  const discountRows = await db.saleDiscount.findMany({
    where: {
      appliedToLotId: { in: ongoingLotIds },
      ...(options.cityId ? { sale: { cityId: options.cityId } } : {}),
    },
    select: {
      currencyId: true,
      discountAmount: true,
      discountDate: true,
      sale: { select: { cityId: true } },
    },
  });
  for (const row of discountRows) {
    if (!isAfterOpening(row.sale.cityId, row.currencyId, row.discountDate)) continue;
    add(row.sale.cityId, row.currencyId, -Number(row.discountAmount || 0));
  }

  return result;
}

/** Single-city owed-to-Haji by currency code (ongoing lots only). */
export async function computeOngoingLotHajiOwedForCity(
  cityId: number,
  db: Db = prisma
): Promise<Record<string, number>> {
  const map = await computeOngoingLotHajiOwedByCity(db, { cityId });
  return map.get(cityId) || {};
}
