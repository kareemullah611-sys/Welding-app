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

  const qty = round2(Number(params.qty));

  if (qty <= 0) {
    if (dist) {
      await db.lotCityGodownAllocation.deleteMany({
        where: { lotCityDistributionId: dist.id, godownId: params.godownId },
      });
      const citySum = await db.lotCityGodownAllocation.aggregate({
        where: { lotCityDistributionId: dist.id },
        _sum: { qty: true },
      });
      const cityTotal = round2(Number(citySum._sum.qty || 0));
      if (cityTotal <= 0) {
        await db.lotCityDistribution.delete({ where: { id: dist.id } });
      } else {
        await db.lotCityDistribution.update({
          where: { id: dist.id },
          data: { allocatedQty: cityTotal },
        });
      }
    }
    return { lotId: params.lotId };
  }

  if (!dist) {
    dist = await db.lotCityDistribution.create({
      data: {
        lotId: params.lotId,
        cityId: params.cityId,
        productId: params.productId,
        allocatedQty: qty,
      },
    });
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

  const citySum = await db.lotCityGodownAllocation.aggregate({
    where: { lotCityDistributionId: dist.id },
    _sum: { qty: true },
  });
  await db.lotCityDistribution.update({
    where: { id: dist.id },
    data: { allocatedQty: round2(Number(citySum._sum.qty || 0)) },
  });

  const countrySum = await db.lotCityDistribution.aggregate({
    where: { lotId: params.lotId, productId: params.productId },
    _sum: { allocatedQty: true },
  });
  const totalQty = round2(Number(countrySum._sum.allocatedQty || 0));
  if (totalQty > 0) {
    await db.lotProduct.upsert({
      where: { lotId_productId: { lotId: params.lotId, productId: params.productId } },
      create: { lotId: params.lotId, productId: params.productId, totalQty },
      update: { totalQty },
    });
  }

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
