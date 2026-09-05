import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function getIntermediaryBalances(
  intermediaryId: number,
  options?: { excludeExchangeId?: number; excludeSupplierPaymentId?: number; excludeShippingLinePaymentId?: number; excludeAgentPaymentId?: number },
  db: DbClient = prisma,
): Promise<Record<string, number>> {
  const excludeExchangeId = options?.excludeExchangeId;
  const excludeSupplierPaymentId = options?.excludeSupplierPaymentId;
  const excludeShippingLinePaymentId = options?.excludeShippingLinePaymentId;
  const excludeAgentPaymentId = options?.excludeAgentPaymentId;

  const [deposits, supplierPayments, shippingLinePayments, agentPayments, liabilityEntries, exchanges, hajiTransfers] = await Promise.all([
    db.intermediaryDeposit.findMany({
      where: { intermediaryId, deletedAt: null },
      select: { amount: true, currency: { select: { code: true } } },
    }),
    db.supplierPayment.findMany({
      where: { intermediaryId, deletedAt: null, ...(excludeSupplierPaymentId ? { id: { not: excludeSupplierPaymentId } } : {}) },
      select: { amountUsd: true },
    }),
    db.shippingLinePayment.findMany({
      where: { intermediaryId, deletedAt: null, ...(excludeShippingLinePaymentId ? { id: { not: excludeShippingLinePaymentId } } : {}) },
      select: { amountUsd: true },
    }),
    db.agentPayment.findMany({
      where: { intermediaryId, deletedAt: null, ...(excludeAgentPaymentId ? { id: { not: excludeAgentPaymentId } } : {}) },
      select: { amount: true, currencyCode: true },
    }),
    db.superAdminLiabilityEntry.findMany({
      where: { intermediaryId },
      select: { amount: true, liabilityEffect: true, currency: { select: { code: true } } },
    }),
    db.intermediaryExchange.findMany({
      where: {
        intermediaryId,
        isActive: true,
        ...(excludeExchangeId ? { id: { not: excludeExchangeId } } : {}),
      },
      select: {
        fromAmount: true,
        toAmount: true,
        fromCurrency: { select: { code: true } },
        toCurrency: { select: { code: true } },
      },
    }),
    db.hajiTransfer.findMany({
      where: { intermediaryId, settlementDestination: "intermediary" },
      select: { amount: true, currency: { select: { code: true } } },
    }),
  ]);

  const balances: Record<string, number> = {};

  for (const deposit of deposits) {
    const code = deposit.currency.code;
    balances[code] = (balances[code] || 0) + Number(deposit.amount);
  }

  for (const payment of supplierPayments) {
    balances.USD = (balances.USD || 0) - Number(payment.amountUsd);
  }

  for (const payment of shippingLinePayments) {
    balances.USD = (balances.USD || 0) - Number(payment.amountUsd);
  }

  for (const payment of agentPayments) {
    const code = String(payment.currencyCode || "PKR").toUpperCase();
    balances[code] = (balances[code] || 0) - Number(payment.amount);
  }

  for (const entry of liabilityEntries) {
    const code = entry.currency.code;
    const direction = Number(entry.liabilityEffect) >= 0 ? 1 : -1;
    balances[code] = (balances[code] || 0) + (Number(entry.amount) * direction);
  }

  for (const exchange of exchanges) {
    balances[exchange.fromCurrency.code] = (balances[exchange.fromCurrency.code] || 0) - Number(exchange.fromAmount);
    balances[exchange.toCurrency.code] = (balances[exchange.toCurrency.code] || 0) + Number(exchange.toAmount);
  }

  for (const transfer of hajiTransfers) {
    const code = transfer.currency.code;
    balances[code] = (balances[code] || 0) + Number(transfer.amount);
  }

  const cashReceipts = await db.hajiCashReceipt.findMany({
    where: { intermediaryId, reversedAt: null },
    select: { amount: true, currency: { select: { code: true } } },
  });
  for (const receipt of cashReceipts) {
    const code = receipt.currency.code;
    balances[code] = (balances[code] || 0) - Number(receipt.amount);
  }

  return balances;
}
