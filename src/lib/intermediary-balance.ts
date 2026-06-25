import prisma from "@/lib/prisma";

export async function getIntermediaryBalances(
  intermediaryId: number,
  options?: { excludeExchangeId?: number }
): Promise<Record<string, number>> {
  const excludeExchangeId = options?.excludeExchangeId;

  const [deposits, payments, exchanges, hajiTransfers] = await Promise.all([
    prisma.intermediaryDeposit.findMany({
      where: { intermediaryId },
      select: { amount: true, currency: { select: { code: true } } },
    }),
    prisma.supplierPayment.findMany({
      where: { intermediaryId },
      select: { amountUsd: true },
    }),
    prisma.intermediaryExchange.findMany({
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
    prisma.hajiTransfer.findMany({
      where: { intermediaryId, settlementDestination: "intermediary" },
      select: { amount: true, currency: { select: { code: true } } },
    }),
  ]);

  const balances: Record<string, number> = {};

  for (const deposit of deposits) {
    const code = deposit.currency.code;
    balances[code] = (balances[code] || 0) + Number(deposit.amount);
  }

  for (const payment of payments) {
    balances.USD = (balances.USD || 0) - Number(payment.amountUsd);
  }

  for (const exchange of exchanges) {
    balances[exchange.fromCurrency.code] = (balances[exchange.fromCurrency.code] || 0) - Number(exchange.fromAmount);
    balances[exchange.toCurrency.code] = (balances[exchange.toCurrency.code] || 0) + Number(exchange.toAmount);
  }

  for (const transfer of hajiTransfers) {
    const code = transfer.currency.code;
    balances[code] = (balances[code] || 0) + Number(transfer.amount);
  }

  const cashReceipts = await prisma.hajiCashReceipt.findMany({
    where: { intermediaryId },
    select: { amount: true, currency: { select: { code: true } } },
  });
  for (const receipt of cashReceipts) {
    const code = receipt.currency.code;
    balances[code] = (balances[code] || 0) - Number(receipt.amount);
  }

  return balances;
}
