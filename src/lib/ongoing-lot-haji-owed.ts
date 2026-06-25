import prisma from "@/lib/prisma";
import { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const ACTIVE_SALE_STATUSES = ["active", "marked_short"] as const;

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

  const [sales, expenses, hajiTransfers, hajiPayments, overflowCredits] = await Promise.all([
    db.sale.groupBy({
      by: ["cityId", "currencyId"],
      where: { ...cityFilter, ...lotFilter, status: { in: [...ACTIVE_SALE_STATUSES] } },
      _sum: { totalAmount: true },
    }),
    db.expense.groupBy({
      by: ["cityId", "currencyId"],
      where: { ...cityFilter, ...lotFilter, deletedAt: null },
      _sum: { amount: true },
    }),
    db.hajiTransfer.groupBy({
      by: ["cityId", "currencyId"],
      where: { ...cityFilter, ...lotFilter },
      _sum: { amount: true },
    }),
    db.payment.groupBy({
      by: ["cityId", "currencyId"],
      where: { ...cityFilter, ...lotFilter, status: "active", destination: "haji" },
      _sum: { amount: true },
    }),
    db.lotSettlementOverflow.groupBy({
      by: ["cityId", "currencyId"],
      where: {
        ...cityFilter,
        toLotId: { in: ongoingLotIds },
      },
      _sum: { overflowAmount: true },
    }),
  ]);

  const add = (cityId: number, currencyId: number, delta: number) => {
    if (!cityId || !currencyId) return;
    const code = currCode[currencyId] || `CUR${currencyId}`;
    const bucket = result.get(cityId) || {};
    bucket[code] = round2((bucket[code] || 0) + delta);
    result.set(cityId, bucket);
  };

  for (const row of sales) {
    add(row.cityId, row.currencyId, Number(row._sum.totalAmount || 0));
  }
  for (const row of expenses) {
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of hajiTransfers) {
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of hajiPayments) {
    add(row.cityId, row.currencyId, -Number(row._sum.amount || 0));
  }
  for (const row of overflowCredits) {
    // Overflow credits into ongoing lots are not real remittances — add back
    add(row.cityId, row.currencyId, Number(row._sum.overflowAmount || 0));
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
      sale: { select: { cityId: true } },
    },
  });
  for (const row of discountRows) {
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
