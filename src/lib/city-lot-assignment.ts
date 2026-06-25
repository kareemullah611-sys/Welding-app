import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";
import { aggregateSingleLotSalesMetrics, fetchLotSalesForMetrics } from "@/lib/lot-sold-metrics";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CityLotAssignmentProduct = {
  productId: number;
  productName: string;
  assignedQty: number;
  soldQty: number;
  soldAmount: number;
  remainingQty: number;
  godownAllocations: Array<{ godownId: number; godownName: string; qty: number }>;
};

export async function getCitySoldQtyByProduct(
  lotId: number,
  cityId: number,
  db: DbClient = prisma
): Promise<Record<number, number>> {
  const sales = await fetchLotSalesForMetrics([lotId], { cityId }, db);
  return aggregateSingleLotSalesMetrics(sales).soldQtyByProduct;
}

export async function getCitySoldMetrics(lotId: number, cityId: number, db: DbClient = prisma) {
  const sales = await fetchLotSalesForMetrics([lotId], { cityId }, db);
  return aggregateSingleLotSalesMetrics(sales);
}

export async function buildCityLotAssignmentDetail(
  lotId: number,
  cityId: number,
  db: DbClient = prisma
): Promise<
  | { ok: false; reason: "not_found" | "not_assigned" }
  | {
      ok: true;
      data: {
        viewMode: "city_assignment";
        id: number;
        lotNumber: string;
        lotDate: string;
        status: string;
        isLegacyStock: boolean;
        country: { id: number; name: string; code: string };
        cityId: number;
        stockSummary: {
          totalCartons: number;
          soldCartons: number;
          remainingCartons: number;
          soldSalesByCurrency: Record<string, number>;
          byProduct: CityLotAssignmentProduct[];
        };
      };
    }
> {
  const lot = await db.lot.findUnique({
    where: { id: lotId },
    include: { country: { select: { id: true, name: true, code: true } } },
  });
  if (!lot) return { ok: false, reason: "not_found" };

  const dists = await db.lotCityDistribution.findMany({
    where: { lotId, cityId },
    include: {
      product: { select: { id: true, name: true } },
      godownAllocations: { include: { godown: { select: { id: true, name: true } } } },
    },
    orderBy: [{ productId: "asc" }],
  });
  if (!dists.length) return { ok: false, reason: "not_assigned" };

  const soldMetrics = await getCitySoldMetrics(lotId, cityId, db);
  const soldByProduct = soldMetrics.soldQtyByProduct;
  const soldAmountByProduct = soldMetrics.soldAmountByProduct;

  const byProduct: CityLotAssignmentProduct[] = dists.map((d) => {
    const assignedQty = Number(d.allocatedQty);
    const soldRaw = Number(soldByProduct[d.productId] || 0);
    const soldQty = Math.min(assignedQty, soldRaw);
    const remainingQty = Math.max(0, assignedQty - soldQty);
    return {
      productId: d.productId,
      productName: d.product.name,
      assignedQty,
      soldQty,
      soldAmount: Number(soldAmountByProduct[d.productId] || 0),
      remainingQty,
      godownAllocations: d.godownAllocations.map((ga) => ({
        godownId: ga.godownId,
        godownName: ga.godown.name,
        qty: Number(ga.qty),
      })),
    };
  });

  const totalCartons = byProduct.reduce((s, p) => s + p.assignedQty, 0);
  const soldCartons = byProduct.reduce((s, p) => s + p.soldQty, 0);
  const remainingCartons = byProduct.reduce((s, p) => s + p.remainingQty, 0);

  return {
    ok: true,
    data: {
      viewMode: "city_assignment",
      id: lot.id,
      lotNumber: lot.lotNumber,
      lotDate: lot.lotDate.toISOString().split("T")[0],
      status: lot.status,
      isLegacyStock: lot.isLegacyStock,
      country: lot.country,
      cityId,
      stockSummary: {
        totalCartons,
        soldCartons,
        remainingCartons,
        soldSalesByCurrency: soldMetrics.soldSalesByCurrency,
        byProduct,
      },
    },
  };
}

export function cityAssignmentMetricsFromDistributions(
  distributions: Array<{ productId: number; productName: string; allocatedQty: number }>,
  soldByProduct: Record<number, number>,
  soldAmountByProduct: Record<number, number> = {}
) {
  const byProduct = distributions.map((d) => {
    const assignedQty = Number(d.allocatedQty);
    const soldQty = Math.min(assignedQty, Number(soldByProduct[d.productId] || 0));
    return {
      productId: d.productId,
      productName: d.productName,
      assignedQty,
      soldQty,
      soldAmount: Number(soldAmountByProduct[d.productId] || 0),
      remainingQty: Math.max(0, assignedQty - soldQty),
    };
  });
  const totalCartons = byProduct.reduce((s, p) => s + p.assignedQty, 0);
  const soldCartons = byProduct.reduce((s, p) => s + p.soldQty, 0);
  return {
    totalCartons,
    soldCartons,
    remainingCartons: Math.max(0, totalCartons - soldCartons),
    byProduct,
  };
}
