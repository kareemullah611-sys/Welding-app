import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

export const LEGACY_LOT_NUMBER = "OLD-STOCK";
export const LEGACY_LOT_DATE = new Date("2000-01-01");

type DbClient = PrismaClient | Prisma.TransactionClient;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getOrCreateLegacyLot(countryId: number, createdBy: number, db: DbClient = prisma) {
  let lot = await db.lot.findFirst({
    where: { countryId, isLegacyStock: true },
  });
  if (lot) return lot;

  const byNumber = await db.lot.findUnique({
    where: { countryId_lotNumber: { countryId, lotNumber: LEGACY_LOT_NUMBER } },
  });
  if (byNumber) {
    if (!byNumber.isLegacyStock) {
      return db.lot.update({
        where: { id: byNumber.id },
        data: { isLegacyStock: true },
      });
    }
    return byNumber;
  }

  return db.lot.create({
    data: {
      countryId,
      lotNumber: LEGACY_LOT_NUMBER,
      lotDate: LEGACY_LOT_DATE,
      status: "ongoing",
      isLegacyStock: true,
      notes: "Legacy opening stock — one lot per country until import lots take over via FIFO",
      createdBy,
    },
  });
}

async function recomputeLegacyLotProductTotals(lotId: number, productId: number, db: DbClient) {
  const countrySum = await db.lotCityDistribution.aggregate({
    where: { lotId, productId },
    _sum: { allocatedQty: true },
  });
  const totalQty = round2(Number(countrySum._sum.allocatedQty || 0));
  if (totalQty <= 0) {
    await db.lotProduct.deleteMany({ where: { lotId, productId } });
    return;
  }

  await db.lotProduct.upsert({
    where: { lotId_productId: { lotId, productId } },
    create: { lotId, productId, totalQty },
    update: { totalQty },
  });
}

export async function setLegacyGodownStock(
  params: {
    cityId: number;
    godownId: number;
    productId: number;
    qty: number;
    createdBy: number;
  },
  db: DbClient = prisma
) {
  const godown = await db.godown.findFirst({
    where: { id: params.godownId, cityId: params.cityId },
    include: { city: { select: { countryId: true } } },
  });
  if (!godown) {
    throw new Error("Godown not found in selected city");
  }

  const lot = await getOrCreateLegacyLot(godown.city.countryId, params.createdBy, db);
  const qty = round2(Number(params.qty));

  let dist = await db.lotCityDistribution.findUnique({
    where: {
      lotId_cityId_productId: {
        lotId: lot.id,
        cityId: params.cityId,
        productId: params.productId,
      },
    },
  });

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
    await recomputeLegacyLotProductTotals(lot.id, params.productId, db);
    return { lotId: lot.id };
  }

  if (!dist) {
    dist = await db.lotCityDistribution.create({
      data: {
        lotId: lot.id,
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

  await recomputeLegacyLotProductTotals(lot.id, params.productId, db);
  return { lotId: lot.id };
}

function mapLegacyAllocationRows(
  allocations: Array<{
    id: number;
    godownId: number;
    productId: number;
    qty: Prisma.Decimal;
    godown: { id: number; name: string; cityId?: number };
    product: { id: number; name: string };
    lotCityDistribution: { lot: { lotDate: Date; notes: string | null; id: number; lotNumber: string } };
  }>
) {
  return allocations
    .filter((a) => Number(a.qty) > 0)
    .map((a) => ({
      id: a.id,
      cityId: a.godown.cityId,
      godownId: a.godownId,
      godownName: a.godown.name,
      godown: { id: a.godown.id, name: a.godown.name },
      productId: a.productId,
      productName: a.product.name,
      product: { id: a.product.id, name: a.product.name },
      qty: Number(a.qty),
      openingDate: a.lotCityDistribution.lot.lotDate.toISOString().split("T")[0],
      notes: a.lotCityDistribution.lot.notes,
      legacyLotId: a.lotCityDistribution.lot.id,
      legacyLotNumber: a.lotCityDistribution.lot.lotNumber,
    }));
}

export async function listLegacyStockForCity(cityId: number) {
  const allocations = await prisma.lotCityGodownAllocation.findMany({
    where: {
      godown: { cityId },
      lotCityDistribution: { lot: { isLegacyStock: true } },
    },
    include: {
      godown: { select: { id: true, name: true, cityId: true } },
      product: { select: { id: true, name: true } },
      lotCityDistribution: {
        include: { lot: { select: { id: true, lotNumber: true, lotDate: true, notes: true } } },
      },
    },
    orderBy: [{ godownId: "asc" }, { productId: "asc" }],
  });
  return mapLegacyAllocationRows(allocations);
}

export async function listLegacyStockForSync(cityId?: number | null) {
  const allocations = await prisma.lotCityGodownAllocation.findMany({
    where: {
      ...(cityId ? { godown: { cityId } } : {}),
      lotCityDistribution: { lot: { isLegacyStock: true } },
    },
    include: {
      godown: { select: { id: true, name: true, cityId: true } },
      product: { select: { id: true, name: true } },
      lotCityDistribution: {
        include: { lot: { select: { id: true, lotNumber: true, lotDate: true, notes: true } } },
      },
    },
    orderBy: [{ godownId: "asc" }, { productId: "asc" }],
  });
  return mapLegacyAllocationRows(allocations);
}

export async function ensureLegacyLotsForAllCountries(createdBy: number) {
  const countries = await prisma.country.findMany({ select: { id: true } });
  for (const country of countries) {
    await getOrCreateLegacyLot(country.id, createdBy);
  }
}

export async function migrateOpeningStocksToLegacyLots(createdBy: number) {
  const rows = await prisma.openingStock.findMany({
    include: {
      godown: { select: { cityId: true } },
    },
  });
  if (!rows.length) return 0;

  for (const row of rows) {
    const qty = Number(row.qty);
    if (qty <= 0) continue;
    await setLegacyGodownStock(
      {
        cityId: row.godown.cityId,
        godownId: row.godownId,
        productId: row.productId,
        qty,
        createdBy: row.createdBy || createdBy,
      },
      prisma
    );
  }

  await prisma.openingStock.deleteMany({});
  return rows.length;
}

async function legacyLotHasDependencies(lotId: number, db: DbClient): Promise<boolean> {
  const [
    sales,
    payments,
    expenses,
    hajiTransfers,
    godownTransfers,
    lotPurchases,
    lotCosts,
    cityTransfers,
  ] = await Promise.all([
    db.sale.count({ where: { lotId } }),
    db.payment.count({ where: { lotId } }),
    db.expense.count({ where: { lotId } }),
    db.hajiTransfer.count({ where: { lotId } }),
    db.godownTransfer.count({ where: { lotId } }),
    db.lotPurchase.count({ where: { lotId } }),
    db.lotCost.count({ where: { lotId } }),
    db.cityTransfer.count({ where: { lotId } }),
  ]);
  return (
    sales + payments + expenses + hajiTransfers + godownTransfers + lotPurchases + lotCosts + cityTransfers
  ) > 0;
}

/** Remove all OLD-STOCK godown qty, imported historical sales, and empty legacy lots. */
export async function purgeLegacyOpeningStockData(db: DbClient = prisma) {
  const historicalSales = await db.sale.findMany({
    where: { isOpeningImport: true },
    select: { id: true },
  });
  for (const sale of historicalSales) {
    await db.saleItem.deleteMany({ where: { saleId: sale.id } });
    await db.saleDiscount.deleteMany({ where: { saleId: sale.id } });
    await db.sale.delete({ where: { id: sale.id } });
  }

  await db.openingStock.deleteMany({});

  const legacyLots = await db.lot.findMany({
    where: { isLegacyStock: true },
    select: { id: true },
  });
  const legacyLotIds = legacyLots.map((lot) => lot.id);

  let legacyAllocationsCleared = 0;
  if (legacyLotIds.length) {
    const distributions = await db.lotCityDistribution.findMany({
      where: { lotId: { in: legacyLotIds } },
      select: { id: true },
    });
    const distributionIds = distributions.map((row) => row.id);
    if (distributionIds.length) {
      const cleared = await db.lotCityGodownAllocation.deleteMany({
        where: { lotCityDistributionId: { in: distributionIds } },
      });
      legacyAllocationsCleared = cleared.count;
      await db.lotCityDistribution.deleteMany({ where: { id: { in: distributionIds } } });
    }
    await db.lotProduct.deleteMany({ where: { lotId: { in: legacyLotIds } } });
  }

  let legacyLotsDeleted = 0;
  for (const lotId of legacyLotIds) {
    if (await legacyLotHasDependencies(lotId, db)) continue;
    await db.lot.delete({ where: { id: lotId } });
    legacyLotsDeleted += 1;
  }

  return {
    historicalSalesDeleted: historicalSales.length,
    legacyAllocationsCleared,
    legacyLotsDeleted,
    legacyLotsRemaining: legacyLotIds.length - legacyLotsDeleted,
  };
}
