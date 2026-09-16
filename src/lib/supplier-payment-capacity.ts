import prisma from "@/lib/prisma";

type PurchaseAmount = {
  productId: number;
  productName: string;
  amountUsd: number;
};

export function calculateSupplierLotPaymentCapacity(input: {
  purchases: PurchaseAmount[];
  payments: Array<{ amountUsd: number }>;
}) {
  const products = [...input.purchases.reduce((rows, purchase) => {
    const current = rows.get(purchase.productId) || {
      productId: purchase.productId,
      productName: purchase.productName,
      amountUsd: 0,
    };
    current.amountUsd += Number(purchase.amountUsd || 0);
    rows.set(purchase.productId, current);
    return rows;
  }, new Map<number, PurchaseAmount>()).values()].map((row) => ({
    ...row,
    amountUsd: Math.round(row.amountUsd * 100) / 100,
  }));
  const purchaseTotalUsd = Math.round(products.reduce((sum, row) => sum + row.amountUsd, 0) * 100) / 100;
  const paidTotalUsd = Math.round(input.payments.reduce((sum, row) => sum + Number(row.amountUsd || 0), 0) * 100) / 100;

  return {
    purchaseTotalUsd,
    paidTotalUsd,
    outstandingUsd: Math.max(0, Math.round((purchaseTotalUsd - paidTotalUsd) * 100) / 100),
    products,
  };
}

export async function getSupplierLotPaymentCapacity(input: {
  supplierId: number;
  lotId: number;
  excludePaymentId?: number;
  db?: any;
}) {
  const db = input.db || prisma;
  const [purchases, payments] = await Promise.all([
    db.lotPurchase.findMany({
      where: { supplierId: input.supplierId, lotId: input.lotId },
      select: {
        productId: true,
        totalPriceUsd: true,
        product: { select: { name: true } },
      },
    }),
    db.supplierPayment.findMany({
      where: {
        supplierId: input.supplierId,
        lotId: input.lotId,
        deletedAt: null,
        ...(input.excludePaymentId ? { id: { not: input.excludePaymentId } } : {}),
      },
      select: { amountUsd: true },
    }),
  ]);

  return calculateSupplierLotPaymentCapacity({
    purchases: purchases.map((row: any) => ({
      productId: row.productId,
      productName: row.product.name,
      amountUsd: Number(row.totalPriceUsd),
    })),
    payments: payments.map((row: any) => ({ amountUsd: Number(row.amountUsd) })),
  });
}

export async function listSupplierLotPaymentOptions(supplierId: number, db: any = prisma) {
  const purchases = await db.lotPurchase.findMany({
    where: { supplierId },
    select: {
      lotId: true,
      productId: true,
      totalPriceUsd: true,
      lot: { select: { lotNumber: true } },
      product: { select: { name: true } },
    },
    orderBy: [{ lot: { lotDate: "desc" } }, { lotId: "desc" }],
  });
  const lotIds = [...new Set<number>(purchases.map((row: any) => row.lotId))];
  const payments = lotIds.length
    ? await db.supplierPayment.findMany({
        where: { supplierId, lotId: { in: lotIds }, deletedAt: null },
        select: { lotId: true, amountUsd: true },
      })
    : [];

  return lotIds.map((lotId) => {
    const lotPurchases = purchases.filter((row: any) => row.lotId === lotId);
    const capacity = calculateSupplierLotPaymentCapacity({
      purchases: lotPurchases.map((row: any) => ({
        productId: row.productId,
        productName: row.product.name,
        amountUsd: Number(row.totalPriceUsd),
      })),
      payments: payments.filter((row: any) => row.lotId === lotId).map((row: any) => ({ amountUsd: Number(row.amountUsd) })),
    });
    return {
      id: lotId,
      lotNumber: lotPurchases[0].lot.lotNumber,
      ...capacity,
    };
  }).filter((row) => row.outstandingUsd > 0);
}
