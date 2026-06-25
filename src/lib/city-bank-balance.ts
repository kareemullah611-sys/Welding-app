import type { PrismaClient } from "@prisma/client";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Available balance for one city bank account in one currency (matches treasury per-account formula). */
export async function getCityBankAccountAvailableBalance(
  db: PrismaClient,
  args: { cityId: number; bankAccountId: number; currencyId: number }
): Promise<number> {
  const { cityId, bankAccountId, currencyId } = args;

  const [
    openingSum,
    paymentsInSum,
    depositsSum,
    hajiSum,
    expensesSum,
    depositIds,
    currency,
    supplierPayments,
  ] = await Promise.all([
    db.openingBankBalance.aggregate({
      where: { cityId, bankAccountId, currencyId },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      where: {
        cityId,
        bankAccountId,
        currencyId,
        destination: "our_account",
        status: "active",
        paymentMethod: { in: ["bank_transfer", "online"] },
      },
      _sum: { amount: true },
    }),
    db.bankDeposit.aggregate({
      where: { cityId, bankAccountId, currencyId },
      _sum: { cashAmount: true },
    }),
    db.hajiTransfer.aggregate({
      where: { cityId, bankAccountId, currencyId },
      _sum: { amount: true },
    }),
    db.expense.aggregate({
      where: { cityId, bankAccountId, currencyId, deletedAt: null },
      _sum: { amount: true },
    }),
    db.bankDeposit.findMany({
      where: { cityId, bankAccountId },
      select: { id: true },
    }),
    db.currency.findUnique({ where: { id: currencyId }, select: { code: true } }),
    db.supplierPayment.findMany({
      where: { bankAccountId },
      select: { amountLocal: true, amountUsd: true, exchangeRate: true },
    }),
  ]);

  const chequesSum =
    depositIds.length > 0
      ? await db.payment.aggregate({
          where: {
            cityId,
            currencyId,
            paymentMethod: "cheque",
            destination: "our_account",
            status: "active",
            chequeStatus: "deposited_to_bank",
            bankDepositId: { in: depositIds.map((row) => row.id) },
          },
          _sum: { amount: true },
        })
      : { _sum: { amount: null as number | null } };

  const currencyCode = String(currency?.code || "").toUpperCase();
  let supplierOut = 0;
  for (const payment of supplierPayments) {
    const amountLocal = Number(payment.amountLocal || 0);
    const amountUsd = Number(payment.amountUsd || 0);
    const exchangeRate = Number(payment.exchangeRate || 0);
    if (currencyCode === "PKR") {
      const amountPkr = amountLocal > 0 ? amountLocal : exchangeRate > 0 ? amountUsd * exchangeRate : 0;
      supplierOut += amountPkr;
    } else if (currencyCode === "USD" && amountUsd > 0 && amountLocal <= 0) {
      supplierOut += amountUsd;
    }
  }

  const balance =
    Number(openingSum._sum.amount || 0) +
    Number(paymentsInSum._sum.amount || 0) +
    Number(depositsSum._sum.cashAmount || 0) +
    Number(chequesSum._sum.amount || 0) -
    Number(hajiSum._sum.amount || 0) -
    Number(expensesSum._sum.amount || 0) -
    supplierOut;

  return round2(balance);
}
