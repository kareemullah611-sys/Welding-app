import type { Prisma, PrismaClient } from "@prisma/client";

import { allocateLiabilitySettlementLayers } from "./realized-liability-fx";
import { LiabilityFxValidationError } from "./realized-liability-fx";

type DbClient = PrismaClient | Prisma.TransactionClient;

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function resolveSupplierSettlementContext(input: {
  supplierId: number;
  lotId: number | null;
  paymentId: number;
  settlementAmountUsd: number;
  actualSettlementPkr: number;
}, db: DbClient) {
  if (!input.lotId) throw new LiabilityFxValidationError("A lot is required to determine the supplier liability carrying basis.");
  const lot = await db.lot.findUnique({
    where: { id: input.lotId },
    select: {
      lotDate: true,
      pkrExchangeRate: true,
      lotPurchases: {
        where: { supplierId: input.supplierId },
        select: { totalPriceUsd: true },
        orderBy: { id: "asc" },
      },
    },
  });
  const carryingRatePkr = Number(lot?.pkrExchangeRate || 0);
  if (!lot || carryingRatePkr <= 0) {
    throw new LiabilityFxValidationError("Supplier liability carrying rate is missing; record the approved historical lot PKR rate before settlement.");
  }
  if (lot.lotPurchases.length === 0) throw new LiabilityFxValidationError("No supplier liability exists for the selected lot.");
  const previous = await db.supplierPayment.aggregate({
    where: { supplierId: input.supplierId, lotId: input.lotId, id: { not: input.paymentId } },
    _sum: { amountUsd: true },
  });
  return allocateLiabilitySettlementLayers({
    layers: lot.lotPurchases.map((purchase) => ({
      amountUsd: Number(purchase.totalPriceUsd),
      carryingRatePkr,
      recognitionDate: dateOnly(lot.lotDate),
    })),
    previouslySettledUsd: Number(previous._sum.amountUsd || 0),
    settlementAmountUsd: input.settlementAmountUsd,
    actualSettlementPkr: input.actualSettlementPkr,
  });
}

export async function resolveShippingSettlementContext(input: {
  shippingLineId: number;
  lotId: number | null;
  paymentId: number;
  settlementAmountUsd: number;
  actualSettlementPkr: number;
}, db: DbClient) {
  if (!input.lotId) throw new LiabilityFxValidationError("A lot is required to determine the shipping liability carrying basis.");
  const lot = await db.lot.findUnique({
    where: { id: input.lotId },
    select: {
      lotDate: true,
      pkrExchangeRate: true,
      lotCosts: {
        where: { shippingLineId: input.shippingLineId, currencyCode: { equals: "USD", mode: "insensitive" } },
        select: { amount: true, exchangeRate: true, costDate: true },
        orderBy: [{ costDate: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!lot || lot.lotCosts.length === 0) throw new LiabilityFxValidationError("No USD shipping liability exists for the selected lot.");
  const lotRate = Number(lot.pkrExchangeRate || 0);
  const layers = lot.lotCosts.map((cost) => {
    const carryingRatePkr = Number(cost.exchangeRate || lotRate);
    if (carryingRatePkr <= 0) {
      throw new LiabilityFxValidationError("Shipping liability carrying rate is missing; record the approved historical cost/lot PKR rate before settlement.");
    }
    return {
      amountUsd: Number(cost.amount),
      carryingRatePkr,
      recognitionDate: dateOnly(cost.costDate || lot.lotDate),
    };
  });
  const previous = await db.shippingLinePayment.aggregate({
    where: { shippingLineId: input.shippingLineId, lotId: input.lotId, id: { not: input.paymentId } },
    _sum: { amountUsd: true },
  });
  return allocateLiabilitySettlementLayers({
    layers,
    previouslySettledUsd: Number(previous._sum.amountUsd || 0),
    settlementAmountUsd: input.settlementAmountUsd,
    actualSettlementPkr: input.actualSettlementPkr,
  });
}
