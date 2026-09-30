import type { PrismaClient, Prisma } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

// C1/H2: journal transactions that make a sale immutable for hard-delete.
// Covers SALE/COGS/DISCOUNT, their REV-* reversals, and the walk-in
// payment's PAY/ADJPAY rows (plus their reversals).
export function saleHistoryJournalWhere(saleId: number, discountIds: number[], paymentIds: number[]) {
  const exact: string[] = [`SALE-${saleId}`, `REV-SALE-${saleId}`, `COGS-${saleId}`, `REV-COGS-${saleId}`];
  for (const discountId of discountIds) exact.push(`DISCOUNT-${discountId}`, `REV-DISCOUNT-${discountId}`);
  for (const paymentId of paymentIds) exact.push(`PAY-${paymentId}`, `REV-PAY-${paymentId}`);
  const prefixes = paymentIds.flatMap((paymentId) => [`ADJPAY-${paymentId}-`, `REV-ADJPAY-${paymentId}-`]);
  return {
    OR: [
      { transactionId: { in: exact } },
      ...prefixes.map((prefix) => ({ transactionId: { startsWith: prefix } })),
    ],
  };
}

// Batch variant for the sales list API: marks each sale with
// hasAccountingHistory so the UI can hide the permanent-delete action.
export async function attachSaleAccountingHistoryFlags(db: DbClient, sales: Array<{ id: number }>) {
  if (sales.length === 0) return;
  const saleIds = sales.map((sale) => sale.id);
  const [discounts, payments] = await Promise.all([
    db.saleDiscount.findMany({ where: { saleId: { in: saleIds } }, select: { id: true, saleId: true } }),
    db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true, saleId: true } }),
  ]);
  const discountsBySale = new Map<number, number[]>();
  for (const discount of discounts) {
    const list = discountsBySale.get(discount.saleId) || [];
    list.push(discount.id);
    discountsBySale.set(discount.saleId, list);
  }
  const paymentsBySale = new Map<number, number[]>();
  for (const payment of payments) {
    if (payment.saleId == null) continue;
    const list = paymentsBySale.get(payment.saleId) || [];
    list.push(payment.id);
    paymentsBySale.set(payment.saleId, list);
  }

  const clauses = sales.flatMap((sale) =>
    saleHistoryJournalWhere(sale.id, discountsBySale.get(sale.id) || [], paymentsBySale.get(sale.id) || []).OR
  );
  const rows = await db.journalEntry.findMany({
    where: { OR: clauses },
    select: { transactionId: true },
  });

  const discountSaleId = new Map(discounts.map((discount) => [discount.id, discount.saleId]));
  const paymentSaleId = new Map(payments.map((payment) => [payment.id, payment.saleId]));
  const flagged = new Set<number>();
  for (const { transactionId } of rows) {
    const saleMatch = transactionId.match(/^(?:REV-)?(?:SALE|COGS)-(\d+)$/);
    if (saleMatch) {
      flagged.add(Number(saleMatch[1]));
      continue;
    }
    const discountMatch = transactionId.match(/^(?:REV-)?DISCOUNT-(\d+)$/);
    if (discountMatch) {
      const saleId = discountSaleId.get(Number(discountMatch[1]));
      if (saleId) flagged.add(saleId);
      continue;
    }
    const payMatch = transactionId.match(/^(?:REV-)?PAY-(\d+)$/);
    if (payMatch) {
      const saleId = paymentSaleId.get(Number(payMatch[1]));
      if (saleId) flagged.add(saleId);
      continue;
    }
    const adjMatch = transactionId.match(/^(?:REV-)?ADJPAY-(\d+)-/);
    if (adjMatch) {
      const saleId = paymentSaleId.get(Number(adjMatch[1]));
      if (saleId) flagged.add(saleId);
    }
  }
  for (const sale of sales) (sale as any).hasAccountingHistory = flagged.has(sale.id);
}

// H2: journal transactions that make a payment immutable for hard-delete.
export function paymentHistoryJournalWhere(paymentIds: number[]) {
  const exact = paymentIds.flatMap((id) => [`PAY-${id}`, `REV-PAY-${id}`]);
  const prefixes = paymentIds.flatMap((id) => [`ADJPAY-${id}-`, `REV-ADJPAY-${id}-`]);
  return {
    OR: [
      { transactionId: { in: exact } },
      ...prefixes.map((prefix) => ({ transactionId: { startsWith: prefix } })),
    ],
  };
}

export async function attachPaymentAccountingHistoryFlags(db: DbClient, payments: Array<{ id: number }>) {
  if (payments.length === 0) return;
  const rows = await db.journalEntry.findMany({
    where: paymentHistoryJournalWhere(payments.map((payment) => payment.id)),
    select: { transactionId: true },
  });
  const flagged = new Set<number>();
  for (const { transactionId } of rows) {
    const match = transactionId.match(/^(?:REV-)?(?:PAY|ADJPAY)-(\d+)/);
    if (match) flagged.add(Number(match[1]));
  }
  for (const payment of payments) (payment as any).hasAccountingHistory = flagged.has(payment.id);
}

// Customer hard-delete rule: any sale, payment, or opening balance makes the
// customer immutable (mirrors CUSTOMER_HAS_ACCOUNTING_HISTORY in the route).
export async function attachCustomerAccountingHistoryFlags(db: DbClient, customers: Array<{ id: number }>) {
  if (customers.length === 0) return;
  const ids = customers.map((customer) => customer.id);
  const [sales, payments, openings] = await Promise.all([
    db.sale.groupBy({ by: ["customerId"], where: { customerId: { in: ids } }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["customerId"], where: { customerId: { in: ids } }, _count: { _all: true } }),
    db.openingCustomerBalance.groupBy({ by: ["customerId"], where: { customerId: { in: ids } }, _count: { _all: true } }),
  ]);
  const flagged = new Set<number>(
    [...sales, ...payments, ...openings].map((row) => row.customerId)
  );
  for (const customer of customers) (customer as any).hasAccountingHistory = flagged.has(customer.id);
}
