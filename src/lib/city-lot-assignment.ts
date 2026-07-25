import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";
import { aggregateLotSalesMetrics, aggregateSingleLotSalesMetrics, fetchLotSalesForMetrics } from "@/lib/lot-sold-metrics";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CityLotAssignmentProduct = {
  productId: number;
  productName: string;
  unitOfMeasure?: string | null;
  piecesPerCarton?: number | null;
  assignedQty: number;
  displayAssignedQty?: number;
  soldQty: number;
  displaySoldQty?: number;
  soldAmount: number;
  remainingQty: number;
  displayRemainingQty?: number;
  godownAllocations: Array<{ godownId: number; godownName: string; qty: number; displayQty?: number }>;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toDisplayStockQty(qty: number, product: { unitOfMeasure?: string | null; piecesPerCarton?: number | null }) {
  const piecesPerCarton = Number(product.piecesPerCarton || 0);
  if (product.unitOfMeasure === "PCS" && piecesPerCarton > 0) {
    return round2(qty / piecesPerCarton);
  }
  return round2(qty);
}

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
  return (
    aggregateLotSalesMetrics(sales).get(lotId) || {
      soldCartons: 0,
      soldSalesByCurrency: {},
      soldQtyByProduct: {},
      soldAmountByProduct: {},
    }
  );
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
      product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } },
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
      unitOfMeasure: d.product.unitOfMeasure,
      piecesPerCarton: d.product.piecesPerCarton,
      assignedQty,
      displayAssignedQty: toDisplayStockQty(assignedQty, d.product),
      soldQty,
      displaySoldQty: toDisplayStockQty(soldQty, d.product),
      soldAmount: Number(soldAmountByProduct[d.productId] || 0),
      remainingQty,
      displayRemainingQty: toDisplayStockQty(remainingQty, d.product),
      godownAllocations: d.godownAllocations.map((ga) => ({
        godownId: ga.godownId,
        godownName: ga.godown.name,
        qty: Number(ga.qty),
        displayQty: toDisplayStockQty(Number(ga.qty), d.product),
      })),
    };
  });

  const totalCartons = byProduct.reduce((s, p) => s + Number(p.displayAssignedQty ?? p.assignedQty), 0);
  const soldCartons = byProduct.reduce((s, p) => s + Number(p.displaySoldQty ?? p.soldQty), 0);
  const remainingCartons = byProduct.reduce((s, p) => s + Number(p.displayRemainingQty ?? p.remainingQty), 0);

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
  distributions: Array<{ productId: number; productName: string; allocatedQty: number; unitOfMeasure?: string | null; piecesPerCarton?: number | null }>,
  soldByProduct: Record<number, number>,
  soldAmountByProduct: Record<number, number> = {}
) {
  const byProduct = distributions.map((d) => {
    const assignedQty = Number(d.allocatedQty);
    const soldQty = Math.min(assignedQty, Number(soldByProduct[d.productId] || 0));
    return {
      productId: d.productId,
      productName: d.productName,
      unitOfMeasure: d.unitOfMeasure,
      piecesPerCarton: d.piecesPerCarton,
      assignedQty,
      displayAssignedQty: toDisplayStockQty(assignedQty, d),
      soldQty,
      displaySoldQty: toDisplayStockQty(soldQty, d),
      soldAmount: Number(soldAmountByProduct[d.productId] || 0),
      remainingQty: Math.max(0, assignedQty - soldQty),
      displayRemainingQty: toDisplayStockQty(Math.max(0, assignedQty - soldQty), d),
    };
  });
  const totalCartons = byProduct.reduce((s, p) => s + Number(p.displayAssignedQty ?? p.assignedQty), 0);
  const soldCartons = byProduct.reduce((s, p) => s + Number(p.displaySoldQty ?? p.soldQty), 0);
  return {
    totalCartons,
    soldCartons,
    remainingCartons: byProduct.reduce((s, p) => s + Number(p.displayRemainingQty ?? p.remainingQty), 0),
    byProduct,
  };
}
