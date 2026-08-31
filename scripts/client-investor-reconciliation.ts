import prisma from "../src/lib/prisma";
import { buildDateRange } from "../src/lib/date-range";
import { buildAuthoritativeFinancialReportResult } from "../src/lib/authoritative-financial-report";
import { buildAuthoritativePoolTransactions } from "../src/lib/authoritative-pool-transactions";
import { buildInvestorAttributionPreview, type AttributionCapitalEvent } from "../src/lib/investor-attribution";
import { buildHistoricalPoolPreview } from "../src/lib/historical-pool-attribution";
import { buildFinalizationDryRun } from "../src/lib/investor-finalization-dry-run";
import { settlementJournalTransactionId } from "../src/lib/realized-liability-fx";

function dateOnly(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function assertCloneTarget() {
  const url = new URL(process.env.DATABASE_URL || "");
  const database = url.pathname.replace(/^\//, "");
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !database.includes("production_clone")) {
    throw new Error("This read-only reconciliation script requires an isolated local production clone.");
  }
  return { host: url.hostname, database };
}

async function loadCapitalEvents(): Promise<AttributionCapitalEvent[]> {
  const participants = await prisma.investmentParticipant.findMany({
    include: { capitalEvents: { orderBy: { effectiveDate: "asc" } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return participants.flatMap((participant) => participant.capitalEvents.map((event) => ({
    participantId: String(participant.id),
    participantName: participant.name,
    participantType: participant.type,
    effectiveDate: dateOnly(event.effectiveDate),
    amountPkr: Number(event.amountPkr),
    eventType: event.eventType,
    investorProfitSharePercent: event.investorProfitSharePercent == null
      ? null
      : Number(event.investorProfitSharePercent),
  })));
}

async function loadPoolTransactions(periodStart: string, periodEnd: string) {
  const periodRange = buildDateRange(periodStart, periodEnd);
  const [journalLines, recognizedForeignSales, supplierSettlements, shippingSettlements] = await Promise.all([
    prisma.journalEntry.findMany({
      where: {
        entryDate: periodRange,
        currencyCode: "PKR",
        account: { accountType: { in: ["revenue", "cogs", "expense"] } },
      },
      select: {
        id: true,
        transactionId: true,
        entryDate: true,
        currencyCode: true,
        debit: true,
        credit: true,
        description: true,
        account: { select: { code: true, accountType: true } },
      },
      orderBy: [{ entryDate: "asc" }, { id: "asc" }],
    }),
    prisma.sale.findMany({
      where: { saleDate: periodRange, status: "active", fxPkrEquivalent: { not: null } },
      select: {
        id: true,
        saleDate: true,
        voucherNo: true,
        fxPkrEquivalent: true,
        customer: { select: { name: true } },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { paymentDate: periodRange, fxPoolDate: { not: null } },
      select: { id: true, journalVersion: true, fxPoolDate: true },
    }),
    prisma.shippingLinePayment.findMany({
      where: { paymentDate: periodRange, fxPoolDate: { not: null } },
      select: { id: true, journalVersion: true, fxPoolDate: true },
    }),
  ]);

  const originalPoolDateByTransactionId = new Map<string, string>();
  for (const payment of supplierSettlements) {
    originalPoolDateByTransactionId.set(
      settlementJournalTransactionId("SUPPPAY", payment.id, payment.journalVersion),
      dateOnly(payment.fxPoolDate!),
    );
  }
  for (const payment of shippingSettlements) {
    originalPoolDateByTransactionId.set(
      settlementJournalTransactionId("SLPAY", payment.id, payment.journalVersion),
      dateOnly(payment.fxPoolDate!),
    );
  }

  return buildAuthoritativePoolTransactions({
    journalLines,
    recognizedForeignSales: recognizedForeignSales.map((sale) => ({
      id: sale.id,
      saleDate: sale.saleDate,
      voucherNo: sale.voucherNo,
      fxPkrEquivalent: sale.fxPkrEquivalent,
      customerName: sale.customer.name,
    })),
    originalPoolDateByTransactionId,
  });
}

async function main() {
  const target = assertCloneTarget();
  const periodStart = process.argv[2] || "2025-01-01";
  const periodEnd = process.argv[3] || new Date().toISOString().slice(0, 10);
  const capitalEvents = await loadCapitalEvents();
  const transactions = await loadPoolTransactions(periodStart, periodEnd);
  const report = await buildAuthoritativeFinancialReportResult({ dateFrom: periodStart, dateTo: periodEnd });
  const attribution = await buildInvestorAttributionPreview({
    periodStart,
    periodEnd,
    capitalEvents,
    getBusinessResult: async (segmentStart, segmentEnd) => {
      const segmentReport = await buildAuthoritativeFinancialReportResult({ dateFrom: segmentStart, dateTo: segmentEnd });
      return { netBusinessProfitPkr: Number(segmentReport.profitAndLoss.netProfit) };
    },
  });
  const historicalPool = buildHistoricalPoolPreview({ periodStart, periodEnd, capitalEvents, transactions });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview: historicalPool });
  const poolInputPkr = Math.round(transactions.reduce((sum, row) => sum + Number(row.amountPkr || 0), 0) * 100) / 100;

  console.log(JSON.stringify({
    mode: "READ_ONLY_RECONCILIATION",
    writesPerformed: 0,
    target,
    period: { periodStart, periodEnd },
    participantCount: new Set(capitalEvents.map((event) => event.participantId)).size,
    capitalEventCount: capitalEvents.length,
    historicalTransactionCount: transactions.length,
    chain: {
      financialReportPkr: Number(report.profitAndLoss.netProfit),
      historicalPoolInputPkr: poolInputPkr,
      investorAttributionInputPkr: attribution.totalBusinessProfitPkr,
      historicalPoolFinalAttributionPkr: historicalPool.aggregateReconciliation.finalRecipientAttributionPkr,
      finalizationSnapshotPkr: dryRun.frozenPreview.sourceFinancialReportResultPkr,
      reportToPoolDifferencePkr: Math.round((Number(report.profitAndLoss.netProfit) - poolInputPkr) * 100) / 100,
      investorReconciliationDifferencePkr: attribution.reconciliationDifferencePkr,
      historicalPoolReconciliationDifferencePkr: historicalPool.aggregateReconciliation.reconciliationDifferencePkr,
      postingDebitCreditDifferencePkr: dryRun.postingSimulation.reconciliation.debitCreditDifferencePkr,
      postingToSnapshotDifferencePkr: dryRun.postingSimulation.reconciliation.postingToSnapshotDifferencePkr,
      snapshotToHistoricalDifferencePkr: dryRun.postingSimulation.reconciliation.snapshotToHistoricalDifferencePkr,
      historicalToFinancialReportDifferencePkr: dryRun.postingSimulation.reconciliation.historicalToFinancialReportDifferencePkr,
    },
    attributionStatus: attribution.reconciliationStatus,
    historicalPoolBlockers: historicalPool.blockedReasons,
    dryRunStatus: dryRun.status,
    dryRunBlockers: dryRun.blockers,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
