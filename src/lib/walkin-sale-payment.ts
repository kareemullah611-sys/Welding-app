import { Prisma } from "@prisma/client";
import { getCustomerAccountId, getCashAccountId, createJournalEntries } from "@/lib/accounting";

function roundMoney(n: number): number { return Math.round(n * 100) / 100; }

// M2: keep the walk-in auto payment aligned with the sale total after a
// discount or correction. The delta is posted as an ADJPAY-* journal pair
// (cash refund / extra collection) so the walk-in AR always nets to zero.
// Credit-mode sales create no payment, so this is a no-op there.
export async function syncWalkInSalePayment(
  tx: Prisma.TransactionClient,
  p: { saleId: number; cityId: number; createdBy: number; entryDate: Date },
): Promise<void> {
  const payment = await tx.payment.findFirst({ where: { saleId: p.saleId, status: "active" } });
  if (!payment) return;
  const sale = await tx.sale.findUnique({
    where: { id: p.saleId },
    select: { totalAmount: true, customerId: true, currency: { select: { code: true } } },
  });
  if (!sale) return;
  const newAmount = roundMoney(Number(sale.totalAmount));
  const oldAmount = roundMoney(Number(payment.amount));
  if (Math.abs(newAmount - oldAmount) < 0.005) return;

  const delta = roundMoney(oldAmount - newAmount);
  const arAccId = await getCustomerAccountId(sale.customerId, tx);
  const cashAccId = await getCashAccountId(p.cityId, tx);
  const description = `Walk-in payment sync #${payment.id}`;
  const lines = delta > 0
    ? [
        { accountId: arAccId, debit: delta, credit: 0, description },
        { accountId: cashAccId, debit: 0, credit: delta, description },
      ]
    : [
        { accountId: arAccId, debit: 0, credit: -delta, description },
        { accountId: cashAccId, debit: -delta, credit: 0, description },
      ];

  const existingRows = await tx.journalEntry.count({
    where: { transactionId: { startsWith: `ADJPAY-${payment.id}-` } },
  });
  const seq = Math.floor(existingRows / 2);
  await tx.payment.update({ where: { id: payment.id }, data: { amount: newAmount } });
  await createJournalEntries(`ADJPAY-${payment.id}-${seq}`, lines, {
    currencyCode: sale.currency.code,
    entityType: "payment_adjustment",
    entityId: payment.id,
    lotId: payment.lotId,
    cityId: p.cityId,
    entryDate: p.entryDate,
    createdBy: p.createdBy,
  }, tx);
}
