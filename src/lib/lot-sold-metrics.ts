import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type LotSoldMetrics = {
  soldCartons: number;
  soldSalesByCurrency: Record<string, number>;
  soldQtyByProduct: Record<number, number>;
  soldAmountByProduct: Record<number, number>;
};

type SaleRow = {
  lotId?: number;
  currency?: { code: string } | null;
  items: Array<{ productId: number; qty: unknown; amount: unknown }>;
};

function emptyMetrics(): LotSoldMetrics {
  return {
    soldCartons: 0,
    soldSalesByCurrency: {},
    soldQtyByProduct: {},
    soldAmountByProduct: {},
  };
}

export function aggregateLotSalesMetrics(sales: SaleRow[]): Map<number, LotSoldMetrics> {
  const byLot = new Map<number, LotSoldMetrics>();
  for (const sale of sales) {
    const lotId = Number(sale.lotId || 0);
    if (!lotId) continue;
    if (!byLot.has(lotId)) byLot.set(lotId, emptyMetrics());
    const metrics = byLot.get(lotId)!;
    const currencyCode = String(sale.currency?.code || "PKR").toUpperCase();
    for (const item of sale.items || []) {
      const productId = Number(item.productId);
      const qty = Number(item.qty || 0);
      const amount = Number(item.amount || 0);
      metrics.soldCartons += qty;
      metrics.soldSalesByCurrency[currencyCode] = (metrics.soldSalesByCurrency[currencyCode] || 0) + amount;
      if (productId) {
        metrics.soldQtyByProduct[productId] = (metrics.soldQtyByProduct[productId] || 0) + qty;
        metrics.soldAmountByProduct[productId] = (metrics.soldAmountByProduct[productId] || 0) + amount;
      }
    }
  }
  return byLot;
}

export function aggregateSingleLotSalesMetrics(sales: Omit<SaleRow, "lotId">[]): LotSoldMetrics {
  const map = aggregateLotSalesMetrics(sales.map((s) => ({ ...s, lotId: 1 })));
  return map.get(1) || emptyMetrics();
}

export async function fetchLotSalesForMetrics(
  lotIds: number[],
  options: { cityId?: number } = {},
  db: DbClient = prisma
) {
  if (!lotIds.length) return [];
  return db.sale.findMany({
    where: {
      lotId: { in: lotIds },
      status: { in: ["active", "marked_short"] },
      ...(options.cityId ? { cityId: options.cityId } : {}),
    },
    select: {
      lotId: true,
      currency: { select: { code: true } },
      items: { select: { productId: true, qty: true, amount: true } },
    },
  });
}

export function formatSoldSalesByCurrency(byCurrency: Record<string, number>): string {
  return Object.entries(byCurrency)
    .filter(([, amount]) => Number(amount) !== 0)
    .map(([code, amount]) => `${code} ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`)
    .join(" · ");
}
