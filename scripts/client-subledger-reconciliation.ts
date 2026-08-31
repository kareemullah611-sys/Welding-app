import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

import { excludeExactlyReversedJournalGroups } from "../src/lib/accounting-correction-reconciliation";
import { addLedgerAmount, compareLedgerBalances, type MoneyByCurrency } from "../src/lib/subledger-reconciliation";

const prisma = new PrismaClient();

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertCloneTarget(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!local || !database.startsWith("welding_app_production_clone_")) {
    throw new Error(`Refusing reconciliation outside isolated local production clone (host=${parsed.hostname}, database=${database}).`);
  }
  return { host: parsed.hostname, database, environment: "ISOLATED_LOCAL_CLONE" };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const target = assertCloneTarget(databaseUrl);

  const [accounts, journals, customers, openings, sales, discounts, payments, purchases, supplierPayments, expenses] = await Promise.all([
    prisma.account.findMany({ select: { id: true, code: true, name: true, accountType: true } }),
    prisma.journalEntry.findMany({ select: { transactionId: true, accountId: true, debit: true, credit: true, currencyCode: true, entryDate: true, entityType: true, entityId: true } }),
    prisma.customer.findMany({ select: { id: true, name: true } }),
    prisma.openingCustomerBalance.findMany({ include: { currency: { select: { code: true } } } }),
    prisma.sale.findMany({ include: { currency: { select: { code: true } } } }),
    prisma.saleDiscount.findMany({ include: { currency: { select: { code: true } } } }),
    prisma.payment.findMany({ include: { currency: { select: { code: true } } } }),
    prisma.lotPurchase.findMany({ select: { id: true, carryingAmountPkr: true, journalVersion: true } }),
    prisma.supplierPayment.findMany({ select: { id: true, carryingAmountPkr: true, journalVersion: true } }),
    prisma.expense.findMany({ select: { id: true, deletedAt: true } }),
  ]);

  const effective = excludeExactlyReversedJournalGroups(journals).effectiveJournalLines;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const transactionIds = new Set(effective.map((line) => line.transactionId));
  const customerRows = [];

  for (const customer of customers) {
    const source: MoneyByCurrency = {};
    for (const opening of openings.filter((row) => row.customerId === customer.id)) {
      addLedgerAmount(source, opening.currency.code, number(opening.amount));
    }
    for (const sale of sales.filter((row) => row.customerId === customer.id && !row.isOpeningImport && ["active", "marked_short"].includes(row.status))) {
      addLedgerAmount(source, sale.currency.code, number(sale.totalAmount));
    }
    for (const discount of discounts.filter((row) => sales.some((sale) => sale.id === row.saleId && sale.customerId === customer.id && ["active", "marked_short"].includes(sale.status)))) {
      addLedgerAmount(source, discount.currency.code, -number(discount.discountAmount));
    }
    for (const payment of payments.filter((row) => row.customerId === customer.id && row.status === "active")) {
      addLedgerAmount(source, payment.currency.code, -number(payment.amount));
    }

    const generalLedger: MoneyByCurrency = {};
    const account = accounts.find((row) => row.code === `1200-C${customer.id}`);
    if (account) {
      for (const line of effective.filter((row) => row.accountId === account.id)) {
        addLedgerAmount(generalLedger, line.currencyCode, number(line.debit) - number(line.credit));
      }
    }
    const balances = compareLedgerBalances(source, generalLedger);
    customerRows.push({ customerId: customer.id, customer: customer.name, accountCode: account?.code || null, balances, reconciled: balances.every((row) => row.reconciled) });
  }

  const journalCoverage = {
    activeSales: sales.filter((sale) => !sale.isOpeningImport && ["active", "marked_short"].includes(sale.status)).map((sale) => ({ id: sale.id, expected: `SALE-${sale.id}`, present: transactionIds.has(`SALE-${sale.id}`) })),
    activePayments: payments.filter((payment) => payment.status === "active").map((payment) => ({ id: payment.id, expected: `PAY-${payment.id}`, present: transactionIds.has(`PAY-${payment.id}`) })),
    activeExpenses: expenses.filter((expense) => !expense.deletedAt).map((expense) => ({ id: expense.id, expected: `EXP-${expense.id}`, present: transactionIds.has(`EXP-${expense.id}`) })),
    correctedPurchases: purchases.map((purchase) => ({
      id: purchase.id,
      carryingAmountPkr: number(purchase.carryingAmountPkr),
      expected: `effective lot_purchase journal for source ${purchase.id}`,
      present: effective.some((line) => line.entityType === "lot_purchase" && line.entityId === purchase.id),
    })),
    correctedSupplierPayments: supplierPayments.map((payment) => ({
      id: payment.id,
      carryingAmountPkr: number(payment.carryingAmountPkr),
      expected: `effective supplier_payment journal for source ${payment.id}`,
      present: effective.some((line) => line.entityType === "supplier_payment" && line.entityId === payment.id),
    })),
  };

  const missingCoverage = Object.fromEntries(Object.entries(journalCoverage).map(([key, rows]) => [key, rows.filter((row) => !row.present)]));
  const accountBalances = accounts.map((account) => {
    const byCurrency: MoneyByCurrency = {};
    for (const line of effective.filter((row) => row.accountId === account.id)) {
      addLedgerAmount(byCurrency, line.currencyCode, number(line.debit) - number(line.credit));
    }
    return { code: account.code, name: account.name, type: account.accountType, debitMinusCreditByCurrency: byCurrency };
  }).filter((row) => Object.keys(row.debitMinusCreditByCurrency).length > 0);

  const report = {
    mode: "READ_ONLY_RECONCILIATION",
    writesPerformed: 0,
    generatedAt: new Date().toISOString(),
    target,
    customerReceivables: {
      totalCustomers: customerRows.length,
      reconciledCustomers: customerRows.filter((row) => row.reconciled).length,
      exceptions: customerRows.filter((row) => !row.reconciled),
    },
    journalCoverage: {
      counts: Object.fromEntries(Object.entries(journalCoverage).map(([key, rows]) => [key, { expected: rows.length, missing: rows.filter((row) => !row.present).length }])),
      missing: missingCoverage,
    },
    accountBalances,
    reconciled: customerRows.every((row) => row.reconciled) && Object.values(missingCoverage).every((rows) => rows.length === 0),
  };

  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) writeFileSync(outputArg.slice("--output=".length), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
