import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { buildAuthoritativeFinancialReportResult } from "../src/lib/authoritative-financial-report";
import { excludeExactlyReversedJournalGroups } from "../src/lib/accounting-correction-reconciliation";

const prisma = new PrismaClient();

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertCloneTarget(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!local || !database.startsWith("welding_app_production_clone_")) {
    throw new Error(`Refusing cutover preview outside isolated local production clone (host=${parsed.hostname}, database=${database}).`);
  }
  return { host: parsed.hostname, database, environment: "ISOLATED_LOCAL_CLONE" };
}

type BalanceBucket = { assets: number; liabilities: number; equity: number; earnings: number };

function emptyBucket(): BalanceBucket {
  return { assets: 0, liabilities: 0, equity: 0, earnings: 0 };
}

function applyLine(bucket: BalanceBucket, accountType: string, debit: number, credit: number) {
  if (accountType === "asset") bucket.assets += debit - credit;
  else if (accountType === "liability") bucket.liabilities += credit - debit;
  else if (accountType === "equity") bucket.equity += credit - debit;
  else if (accountType === "revenue") bucket.earnings += credit - debit;
  else if (accountType === "cogs" || accountType === "expense") bucket.earnings -= debit - credit;
}

function finalizeBucket(bucket: BalanceBucket) {
  return {
    assets: round2(bucket.assets),
    liabilities: round2(bucket.liabilities),
    equity: round2(bucket.equity),
    cumulativeEarnings: round2(bucket.earnings),
    ASSETS_MINUS_LIABILITIES_EQUITY_EARNINGS: round2(bucket.assets - bucket.liabilities - bucket.equity - bucket.earnings),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const target = assertCloneTarget(databaseUrl);
  const correctionArg = process.argv.find((arg) => arg.startsWith("--correction-preview="));
  if (!correctionArg) throw new Error("--correction-preview is required.");
  const correctionPreview = JSON.parse(readFileSync(correctionArg.slice("--correction-preview=".length), "utf8"));

  const [accounts, journals, currentFinancialReport, openingCounts, sourceCounts] = await Promise.all([
    prisma.account.findMany({ select: { id: true, code: true, name: true, accountType: true } }),
    prisma.journalEntry.findMany({ select: { transactionId: true, accountId: true, debit: true, credit: true, currencyCode: true, entryDate: true } }),
    buildAuthoritativeFinancialReportResult({ dateFrom: "1900-01-01", dateTo: new Date().toISOString().slice(0, 10) }),
    Promise.all([
      prisma.openingCash.count(),
      prisma.openingBankBalance.count(),
      prisma.openingCheque.count(),
      prisma.openingStock.count(),
      prisma.openingCustomerBalance.count(),
      prisma.openingLiability.count(),
      prisma.openingHajiBalance.count(),
    ]),
    Promise.all([
      prisma.city.count(),
      prisma.godown.count(),
      prisma.customer.count(),
      prisma.supplier.count(),
      prisma.sale.count(),
      prisma.lot.count(),
      prisma.lotPurchase.count(),
      prisma.journalEntry.count(),
    ]),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const baseline = new Map<string, BalanceBucket>();
  const corrected = new Map<string, BalanceBucket>();
  const groupBalance = new Map<string, { debit: number; credit: number }>();

  const correctionReconciliation = excludeExactlyReversedJournalGroups(journals);
  for (const line of correctionReconciliation.effectiveJournalLines) {
    const account = accountById.get(line.accountId);
    if (!account) continue;
    const currency = line.currencyCode.toUpperCase();
    if (!baseline.has(currency)) baseline.set(currency, emptyBucket());
    if (!corrected.has(currency)) corrected.set(currency, emptyBucket());
    applyLine(baseline.get(currency)!, account.accountType, number(line.debit), number(line.credit));
    applyLine(corrected.get(currency)!, account.accountType, number(line.debit), number(line.credit));
    const groupKey = `${line.transactionId}:${currency}`;
    const group = groupBalance.get(groupKey) || { debit: 0, credit: 0 };
    group.debit += number(line.debit);
    group.credit += number(line.credit);
    groupBalance.set(groupKey, group);
  }

  const approvedCorrections = correctionPreview.corrections.filter((correction: any) => correction.status === "READY_FOR_APPROVAL");
  for (const correction of approvedCorrections) {
    for (const line of [...(correction.proposedReversal || []), ...(correction.proposedCorrectedJournal || [])]) {
      const accountCode = String(line.accountCode || "");
      const account = accountById.get(Number(line.accountId)) || accountByCode.get(accountCode);
      const accountType = account?.accountType || (accountCode === "FX-GAIN" ? "revenue" : accountCode === "FX-LOSS" ? "expense" : null);
      if (!accountType) continue;
      const currency = String(line.currencyCode || "PKR").toUpperCase();
      if (!corrected.has(currency)) corrected.set(currency, emptyBucket());
      applyLine(corrected.get(currency)!, accountType, number(line.debit), number(line.credit));
    }
  }

  const unbalancedJournalGroups = [...groupBalance.entries()].flatMap(([key, balance]) => {
    const difference = round2(balance.debit - balance.credit);
    return Math.abs(difference) > 0.01 ? [{ key, debit: round2(balance.debit), credit: round2(balance.credit), difference }] : [];
  });
  const baselineBalanceSheet = Object.fromEntries([...baseline.entries()].map(([currency, bucket]) => [currency, finalizeBucket(bucket)]));
  const correctedPreviewBalanceSheet = Object.fromEntries([...corrected.entries()].map(([currency, bucket]) => [currency, finalizeBucket(bucket)]));
  const correctedPnlImpactPkr = round2(approvedCorrections.reduce((sum: number, correction: any) => sum + number(correction.impact?.pnlPkr), 0));
  const correctedExpenseImpactPkr = round2(approvedCorrections.reduce((sum: number, correction: any) => sum + number(correction.impact?.expensePkr), 0));
  const correctedFxGainsPkr = round2(approvedCorrections.reduce((sum: number, correction: any) => sum + Math.max(0, number(correction.impact?.fxPkr)), 0));
  const correctedFxLossesPkr = round2(approvedCorrections.reduce((sum: number, correction: any) => sum + Math.max(0, -number(correction.impact?.fxPkr)), 0));
  const correctedNetProfitPkr = round2(currentFinancialReport.profitAndLoss.netProfit + correctedPnlImpactPkr);

  const report = {
    mode: "READ_ONLY_PREVIEW",
    writesPerformed: 0,
    generatedAt: new Date().toISOString(),
    target,
    sourceCounts: { cities: sourceCounts[0], godowns: sourceCounts[1], customers: sourceCounts[2], suppliers: sourceCounts[3], sales: sourceCounts[4], lots: sourceCounts[5], lotPurchases: sourceCounts[6], journalEntries: sourceCounts[7] },
    openingSetupCoverage: { cash: openingCounts[0], banks: openingCounts[1], cheques: openingCounts[2], stock: openingCounts[3], customerBalances: openingCounts[4], liabilities: openingCounts[5], hajiBalances: openingCounts[6] },
    baselineBalanceSheet,
    correctedPreviewBalanceSheet,
    currentFinancialReport: currentFinancialReport.profitAndLoss,
    correctedPreviewPnl: {
      ...currentFinancialReport.profitAndLoss,
      totalExpenses: round2(currentFinancialReport.profitAndLoss.totalExpenses + correctedExpenseImpactPkr),
      totalFxGains: round2(currentFinancialReport.profitAndLoss.totalFxGains + correctedFxGainsPkr),
      totalFxLosses: round2(currentFinancialReport.profitAndLoss.totalFxLosses + correctedFxLossesPkr),
      correctionImpactPkr: correctedPnlImpactPkr,
      netProfit: correctedNetProfitPkr,
      netMarginPercent: currentFinancialReport.profitAndLoss.totalRevenue > 0
        ? round2((correctedNetProfitPkr / currentFinancialReport.profitAndLoss.totalRevenue) * 100)
        : 0,
    },
    correctionPreview: { total: correctionPreview.corrections.length, approvedForVirtualPreview: approvedCorrections.length, blocked: correctionPreview.corrections.length - approvedCorrections.length },
    unbalancedJournalGroups,
    correctionReconciliation: {
      exactReversalPairs: correctionReconciliation.exactReversalPairs.length,
      unmatchedReversalTransactionIds: correctionReconciliation.unmatchedReversalTransactionIds,
    },
    cutoverEquationReady: unbalancedJournalGroups.length === 0 &&
      correctionReconciliation.unmatchedReversalTransactionIds.length === 0 &&
      Object.values(correctedPreviewBalanceSheet).every((row: any) => Math.abs(row.ASSETS_MINUS_LIABILITIES_EQUITY_EARNINGS) <= 0.01),
  };
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) writeFileSync(outputArg.slice("--output=".length), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
