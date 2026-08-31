import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { allocateLiabilitySettlement, allocateLiabilitySettlementLayers, buildRealizedFxPostingAmounts } from "../src/lib/realized-liability-fx";
import { excludeExactlyReversedJournalGroups } from "../src/lib/accounting-correction-reconciliation";

const prisma = new PrismaClient();

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return grouped;
}

function assertCloneTarget(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!local || !database.startsWith("welding_app_production_clone_")) {
    throw new Error(`Refusing preview outside isolated local production clone (host=${parsed.hostname}, database=${database}).`);
  }
  return { host: parsed.hostname, database, environment: "ISOLATED_LOCAL_CLONE" };
}

function journalSnapshot(lines: Array<any>) {
  return lines.map((line) => ({
    id: line.id,
    transactionId: line.transactionId,
    accountId: line.accountId,
    accountCode: line.account.code,
    accountName: line.account.name,
    accountType: line.account.accountType,
    debit: number(line.debit),
    credit: number(line.credit),
    currencyCode: line.currencyCode,
    entryDate: line.entryDate.toISOString().slice(0, 10),
    entityType: line.entityType,
    entityId: line.entityId,
    lotId: line.lotId,
    cityId: line.cityId,
    exchangeRate: line.exchangeRate ? number(line.exchangeRate) : null,
    description: line.description,
    createdBy: line.createdBy,
  }));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const target = assertCloneTarget(databaseUrl);

  const [purchases, purchaseJournals, supplierPayments, supplierJournals, personalExpenses, personalExpenseJournals, existingCorrectionJournals, legacyReversalJournals] = await Promise.all([
    prisma.lotPurchase.findMany({
      include: { lot: { select: { lotNumber: true, lotDate: true, pkrExchangeRate: true, pkrExchangeRateMetadata: true } }, supplier: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: [{ lotId: "asc" }, { id: "asc" }],
    }),
    prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: "PURCH-" } },
      include: { account: { select: { code: true, name: true, accountType: true } } },
      orderBy: [{ transactionId: "asc" }, { lineNumber: "asc" }],
    }),
    prisma.supplierPayment.findMany({
      include: { lot: { select: { id: true, lotNumber: true, lotDate: true, pkrExchangeRate: true, pkrExchangeRateMetadata: true } }, supplier: { select: { name: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: "SUPPPAY-" } },
      include: { account: { select: { code: true, name: true, accountType: true } } },
      orderBy: [{ transactionId: "asc" }, { lineNumber: "asc" }],
    }),
    prisma.superAdminPersonalExpense.findMany({ orderBy: { id: "asc" } }),
    prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: "SAEXP-" } },
      include: { account: { select: { code: true, name: true, accountType: true } } },
      orderBy: [{ transactionId: "asc" }, { lineNumber: "asc" }],
    }),
    prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: "CORR-" } },
      select: { transactionId: true },
      distinct: ["transactionId"],
    }),
    prisma.journalEntry.findMany({
      where: { transactionId: { startsWith: "REV-" } },
      include: { account: { select: { code: true, name: true, accountType: true } } },
      orderBy: [{ transactionId: "asc" }, { lineNumber: "asc" }],
    }),
  ]);

  const existingCorrectionTransactionIds = new Set(existingCorrectionJournals.map((row) => row.transactionId));
  const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const purchaseReconciliation = excludeExactlyReversedJournalGroups([
    ...purchaseJournals,
    ...legacyReversalJournals.filter((line) => line.transactionId.startsWith("REV-PURCH-")),
  ]);
  if (purchaseReconciliation.unmatchedReversalTransactionIds.length > 0) {
    throw new Error(`Unmatched legacy purchase reversals: ${purchaseReconciliation.unmatchedReversalTransactionIds.join(", ")}`);
  }
  const purchaseJournalGroups = groupBy(
    purchaseReconciliation.effectiveJournalLines.filter((line) => line.transactionId.startsWith("PURCH-")),
    (line) => line.transactionId,
  );
  const purchaseCorrections = purchases.flatMap((purchase) => {
    const transactionId = `PURCH-${purchase.lotId}-${purchase.id}`;
    if (existingCorrectionTransactionIds.has(`CORR-${transactionId}`)) return [];
    const original = purchaseJournalGroups.get(transactionId) || [];
    const rate = number(purchase.carryingRatePkr || purchase.lot.pkrExchangeRate);
    const carryingAmountPkr = round2(number(purchase.totalPriceUsd) * rate);
    if (original.length === 0) return [];
    const alreadyCorrect = original.every((line) => line.currencyCode === "PKR") &&
      round2(original.reduce((sum, line) => sum + number(line.debit), 0)) === carryingAmountPkr;
    if (alreadyCorrect) return [];
    const inventoryLine = original.find((line) => line.account.accountType === "asset");
    const liabilityLine = original.find((line) => line.account.accountType === "liability");
    return [{
      correctionType: "purchase_basis_correction",
      source: { purchaseId: purchase.id, lotId: purchase.lotId, lotNumber: purchase.lot.lotNumber, supplier: purchase.supplier.name, product: purchase.product.name, totalUsd: number(purchase.totalPriceUsd), recognitionDate: purchase.lot.lotDate.toISOString().slice(0, 10) },
      originalJournal: journalSnapshot(original),
      proposedReversal: journalSnapshot(original).map((line) => ({ ...line, debit: line.credit, credit: line.debit, transactionId: `CORR-REV-${transactionId}` })),
      proposedCorrectedJournal: rate > 0 && inventoryLine && liabilityLine ? [
        { transactionId: `CORR-${transactionId}`, accountId: inventoryLine.accountId, accountCode: inventoryLine.account.code, debit: carryingAmountPkr, credit: 0, currencyCode: "PKR" },
        { transactionId: `CORR-${transactionId}`, accountId: liabilityLine.accountId, accountCode: liabilityLine.account.code, debit: 0, credit: carryingAmountPkr, currencyCode: "PKR" },
      ] : [],
      proposedSourceUpdate: rate > 0 ? {
        carryingRatePkr: rate,
        carryingAmountPkr,
        recognitionDate: purchase.lot.lotDate.toISOString().slice(0, 10),
        recognitionRateMetadata: {
          correctionPurpose: "HISTORICAL_PURCHASE_BASIS_REMEDIATION",
          lotId: purchase.lotId,
          lotNumber: purchase.lot.lotNumber,
          lotRateMetadata: purchase.lot.pkrExchangeRateMetadata,
        },
      } : null,
      impact: { inventoryPkr: carryingAmountPkr, supplierLiabilityPkr: carryingAmountPkr, cashPkr: 0, pnlPkr: 0, fxPkr: 0 },
      auditLinkage: { originalTransactionId: transactionId, proposedReversalId: `CORR-REV-${transactionId}`, proposedCorrectionId: `CORR-${transactionId}` },
      status: rate > 0 && inventoryLine && liabilityLine ? "READY_FOR_APPROVAL" : "BLOCKED_MISSING_RATE_OR_ACCOUNT",
      carryingRatePkr: rate || null,
    }];
  });

  const orphanPurchaseCorrections = [...purchaseJournalGroups.entries()].flatMap(([transactionId, lines]) => {
    if (existingCorrectionTransactionIds.has(`CORR-REV-${transactionId}`)) return [];
    const sourceIds = new Set(lines.map((line) => line.entityId).filter((id): id is number => id != null));
    const hasSource = [...sourceIds].some((id) => purchaseById.has(id));
    if (hasSource) return [];
    return [{
      correctionType: "orphan_purchase_journal",
      source: { transactionId, entityIds: [...sourceIds] },
      originalJournal: journalSnapshot(lines),
      proposedReversal: journalSnapshot(lines).map((line) => ({ ...line, debit: line.credit, credit: line.debit, transactionId: `CORR-REV-${transactionId}` })),
      proposedCorrectedJournal: [],
      impact: { inventoryByCurrency: Object.fromEntries(lines.filter((line) => line.account.accountType === "asset").map((line) => [line.currencyCode, round2(number(line.credit) - number(line.debit))])), pnlPkr: 0 },
      auditLinkage: { originalTransactionId: transactionId, proposedReversalId: `CORR-REV-${transactionId}` },
      status: "READY_FOR_APPROVAL",
    }];
  });

  const supplierReconciliation = excludeExactlyReversedJournalGroups([
    ...supplierJournals,
    ...legacyReversalJournals.filter((line) => line.transactionId.startsWith("REV-SUPPPAY-")),
  ]);
  if (supplierReconciliation.unmatchedReversalTransactionIds.length > 0) {
    throw new Error(`Unmatched legacy supplier-payment reversals: ${supplierReconciliation.unmatchedReversalTransactionIds.join(", ")}`);
  }
  const supplierJournalGroups = groupBy(
    supplierReconciliation.effectiveJournalLines.filter((line) => line.transactionId.startsWith("SUPPPAY-")),
    (line) => line.transactionId,
  );
  const supplierCorrections = supplierPayments.flatMap((payment) => {
    const transactionId = payment.journalVersion === 1 ? `SUPPPAY-${payment.id}` : `SUPPPAY-${payment.id}-V${payment.journalVersion}`;
    if (existingCorrectionTransactionIds.has(`CORR-${transactionId}`)) return [];
    const original = supplierJournalGroups.get(transactionId) || [];
    if (original.length === 0) return [];
    const currencies = new Set(original.map((line) => line.currencyCode));
    const debits = original.reduce((sum, line) => sum + number(line.debit), 0);
    const credits = original.reduce((sum, line) => sum + number(line.credit), 0);
    if (currencies.size === 1 && original[0].currencyCode === "PKR" && round2(debits - credits) === 0) return [];
    let carryingRatePkr = number(payment.carryingRatePkr || payment.lot?.pkrExchangeRate);
    const actualSettlementPkr = number(payment.amountLocal);
    let settlement: ReturnType<typeof allocateLiabilitySettlement> | ReturnType<typeof allocateLiabilitySettlementLayers> | null = null;
    if (carryingRatePkr > 0 && actualSettlementPkr > 0) {
      settlement = allocateLiabilitySettlement({ liabilityAmountUsd: number(payment.amountUsd), carryingRatePkr, previouslySettledUsd: 0, settlementAmountUsd: number(payment.amountUsd), actualSettlementPkr });
    } else if (actualSettlementPkr > 0) {
      const layers = purchases
        .filter((purchase) => purchase.supplierId === payment.supplierId && purchase.lot.lotDate <= payment.paymentDate)
        .map((purchase) => ({
          amountUsd: number(purchase.totalPriceUsd),
          carryingRatePkr: number(purchase.carryingRatePkr || purchase.lot.pkrExchangeRate),
          recognitionDate: purchase.lot.lotDate.toISOString().slice(0, 10),
        }))
        .filter((layer) => layer.amountUsd > 0 && layer.carryingRatePkr > 0);
      const previouslySettledUsd = supplierPayments
        .filter((previous) => previous.supplierId === payment.supplierId && previous.id < payment.id)
        .reduce((sum, previous) => sum + number(previous.amountUsd), 0);
      if (layers.length > 0) {
        settlement = allocateLiabilitySettlementLayers({
          layers,
          previouslySettledUsd,
          settlementAmountUsd: number(payment.amountUsd),
          actualSettlementPkr,
        });
        carryingRatePkr = settlement.carryingRatePkr;
      }
    }
    const liabilityLine = original.find((line) => line.account.accountType === "liability");
    const sourceLine = original.find((line) => line.account.accountType === "asset");
    const posting = settlement ? buildRealizedFxPostingAmounts({ carryingAmountPkr: settlement.carryingAmountPkr, actualSettlementPkr }) : null;
    return [{
      correctionType: "supplier_settlement_correction",
      source: { paymentId: payment.id, supplier: payment.supplier.name, lot: payment.lot?.lotNumber || null, paymentDate: payment.paymentDate.toISOString().slice(0, 10), amountUsd: number(payment.amountUsd), actualSettlementPkr },
      originalJournal: journalSnapshot(original),
      proposedReversal: journalSnapshot(original).map((line) => ({ ...line, debit: line.credit, credit: line.debit, transactionId: `CORR-REV-${transactionId}` })),
      proposedCorrectedJournal: posting && liabilityLine && sourceLine ? [
        { transactionId: `CORR-${transactionId}`, accountId: liabilityLine.accountId, accountCode: liabilityLine.account.code, debit: posting.liabilityDebitPkr, credit: 0, currencyCode: "PKR" },
        { transactionId: `CORR-${transactionId}`, accountId: sourceLine.accountId, accountCode: sourceLine.account.code, debit: 0, credit: posting.sourceCreditPkr, currencyCode: "PKR" },
        ...(posting.fxLossDebitPkr ? [{ transactionId: `CORR-${transactionId}`, accountCode: "FX-LOSS", debit: posting.fxLossDebitPkr, credit: 0, currencyCode: "PKR" }] : []),
        ...(posting.fxGainCreditPkr ? [{ transactionId: `CORR-${transactionId}`, accountCode: "FX-GAIN", debit: 0, credit: posting.fxGainCreditPkr, currencyCode: "PKR" }] : []),
      ] : [],
      proposedSourceUpdate: settlement ? {
        carryingRatePkr: settlement.carryingRatePkr,
        carryingAmountPkr: settlement.carryingAmountPkr,
        realizedFxPkr: settlement.realizedFxPkr,
        fxPoolDate: "originalPoolDate" in settlement ? settlement.originalPoolDate : payment.paymentDate.toISOString().slice(0, 10),
      } : null,
      impact: posting ? { supplierLiabilityPkr: -posting.liabilityDebitPkr, cashPkr: -posting.sourceCreditPkr, pnlPkr: round2(posting.fxGainCreditPkr - posting.fxLossDebitPkr), fxPkr: round2(posting.fxGainCreditPkr - posting.fxLossDebitPkr) } : null,
      auditLinkage: { originalTransactionId: transactionId, proposedReversalId: `CORR-REV-${transactionId}`, proposedCorrectionId: `CORR-${transactionId}` },
      status: posting && liabilityLine && sourceLine ? "READY_FOR_APPROVAL" : "BLOCKED_MISSING_CARRYING_BASIS_OR_ACCOUNT",
      carryingRatePkr: carryingRatePkr || null,
      consumedLiabilityLayers: settlement && "consumedLayers" in settlement ? settlement.consumedLayers : [],
    }];
  });

  const personalExpenseReconciliation = excludeExactlyReversedJournalGroups([
    ...personalExpenseJournals,
    ...legacyReversalJournals.filter((line) => line.transactionId.startsWith("REV-SAEXP-")),
  ]);
  if (personalExpenseReconciliation.unmatchedReversalTransactionIds.length > 0) {
    throw new Error(`Unmatched legacy personal-expense reversals: ${personalExpenseReconciliation.unmatchedReversalTransactionIds.join(", ")}`);
  }
  const personalJournalGroups = groupBy(
    personalExpenseReconciliation.effectiveJournalLines.filter((line) => line.transactionId.startsWith("SAEXP-")),
    (line) => line.transactionId,
  );
  const duplicateExpenseCorrections = personalExpenses.flatMap((expense) => {
    if (existingCorrectionTransactionIds.has(`CORR-SAEXP-${expense.id}`)) return [];
    const related = [...personalJournalGroups.entries()].filter(([transactionId]) => transactionId === `SAEXP-${expense.id}` || transactionId.startsWith(`SAEXP-${expense.id}-V`)).flatMap(([, lines]) => lines);
    const expenseDebits = round2(related.filter((line) => line.account.accountType === "expense").reduce((sum, line) => sum + number(line.debit) - number(line.credit), 0));
    const excessPkr = round2(expenseDebits - (expense.deletedAt ? 0 : number(expense.amount)));
    if (excessPkr <= 0) return [];
    const expenseLine = related.find((line) => line.account.accountType === "expense");
    const bankLine = related.find((line) => line.account.accountType === "asset");
    return [{
      correctionType: "duplicate_personal_expense_correction",
      source: { expenseId: expense.id, authoritativeAmountPkr: expense.deletedAt ? 0 : number(expense.amount), journalExpensePkr: expenseDebits, excessPkr },
      originalJournal: journalSnapshot(related),
      proposedReversal: [],
      proposedCorrectedJournal: expenseLine && bankLine ? [
        { transactionId: `CORR-SAEXP-${expense.id}`, accountId: bankLine.accountId, accountCode: bankLine.account.code, debit: excessPkr, credit: 0, currencyCode: "PKR" },
        { transactionId: `CORR-SAEXP-${expense.id}`, accountId: expenseLine.accountId, accountCode: expenseLine.account.code, debit: 0, credit: excessPkr, currencyCode: "PKR" },
      ] : [],
      impact: { bankPkr: excessPkr, expensePkr: -excessPkr, pnlPkr: excessPkr },
      auditLinkage: { sourceEntity: `super_admin_personal_expenses:${expense.id}`, proposedCorrectionId: `CORR-SAEXP-${expense.id}` },
      status: expenseLine && bankLine ? "READY_FOR_APPROVAL" : "BLOCKED_MISSING_ACCOUNT",
    }];
  });

  const corrections = [...purchaseCorrections, ...orphanPurchaseCorrections, ...supplierCorrections, ...duplicateExpenseCorrections];
  const report = {
    mode: "READ_ONLY_PREVIEW",
    writesPerformed: 0,
    generatedAt: new Date().toISOString(),
    target,
    summary: {
      purchaseBasisCorrections: purchaseCorrections.length,
      orphanPurchaseJournals: orphanPurchaseCorrections.length,
      supplierSettlementCorrections: supplierCorrections.length,
      duplicatePersonalExpenseCorrections: duplicateExpenseCorrections.length,
      readyForApproval: corrections.filter((row) => row.status === "READY_FOR_APPROVAL").length,
      blocked: corrections.filter((row) => row.status !== "READY_FOR_APPROVAL").length,
    },
    corrections,
  };
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) writeFileSync(outputArg.slice("--output=".length), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
