import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function setLotGodownStock(
  params: {
    lotId: number;
    cityId: number;
    godownId: number;
    productId: number;
    qty: number;
  },
  db: DbClient = prisma
) {
  const lot = await db.lot.findFirst({
    where: { id: params.lotId, status: "ongoing", isLegacyStock: false },
  });
  if (!lot) throw new Error("Ongoing non-legacy lot not found");

  const godown = await db.godown.findFirst({
    where: { id: params.godownId, cityId: params.cityId },
  });
  if (!godown) throw new Error("Godown not found in selected city");

  let dist = await db.lotCityDistribution.findUnique({
    where: {
      lotId_cityId_productId: {
        lotId: params.lotId,
        cityId: params.cityId,
        productId: params.productId,
      },
    },
  });
  if (!dist) throw new Error("No distribution found for this lot/city/product combination");

  const qty = round2(Number(params.qty));

  if (qty <= 0) {
    await db.lotCityGodownAllocation.deleteMany({
      where: { lotCityDistributionId: dist.id, godownId: params.godownId },
    });
    return { lotId: params.lotId };
  }

  const existingCitySum = await db.lotCityGodownAllocation.aggregate({
    where: {
      lotCityDistributionId: dist.id,
      NOT: { godownId: params.godownId },
    },
    _sum: { qty: true },
  });
  const nextCityTotal = round2(Number(existingCitySum._sum.qty || 0) + qty);
  if (nextCityTotal > Number(dist.allocatedQty)) {
    throw new Error(`Total godown allocation (${nextCityTotal}) exceeds city distribution (${Number(dist.allocatedQty)})`);
  }

  await db.lotCityGodownAllocation.upsert({
    where: {
      lotCityDistributionId_godownId: {
        lotCityDistributionId: dist.id,
        godownId: params.godownId,
      },
    },
    create: {
      lotCityDistributionId: dist.id,
      godownId: params.godownId,
      productId: params.productId,
      qty,
    },
    update: { qty },
  });

  return { lotId: params.lotId, distributionId: dist.id };
}

export async function listLotGodownStockForCity(cityId: number) {
  const allocations = await prisma.lotCityGodownAllocation.findMany({
    where: {
      godown: { cityId },
      qty: { gt: 0 },
      lotCityDistribution: {
        lot: { status: "ongoing", isLegacyStock: false },
      },
    },
    include: {
      godown: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
      lotCityDistribution: {
        include: { lot: { select: { id: true, lotNumber: true, lotDate: true } } },
      },
    },
    orderBy: [{ godownId: "asc" }, { productId: "asc" }],
  });

  return allocations.map((a) => ({
    id: a.id,
    godownId: a.godownId,
    godownName: a.godown.name,
    productId: a.productId,
    productName: a.product.name,
    qty: Number(a.qty),
    lotId: a.lotCityDistribution.lot.id,
    lotNumber: a.lotCityDistribution.lot.lotNumber,
    openingDate: a.lotCityDistribution.lot.lotDate.toISOString().split("T")[0],
  }));
}
