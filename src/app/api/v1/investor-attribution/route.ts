import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  buildInvestorAttributionPreview,
  type AttributionCapitalEvent,
  type AttributionProfitShareEvent,
} from "@/lib/investor-attribution";
import { buildPeriodProfitReportData } from "@/lib/period-profit-report-data";
import { getCountryFallbackRateToPkr } from "@/lib/intermediary-usd-fifo";
import { buildLegacyInvestorCapitalReview } from "@/lib/legacy-investor-capital-review";
import {
  buildHistoricalPoolPreview,
  type HistoricalPoolTransaction,
} from "@/lib/historical-pool-attribution";
import {
  normalizeExchangeRateRow,
  sarafiAfIntegrationStatus,
  selectRateForPosition,
  type NormalizedExchangeRateResult,
} from "@/lib/exchange-rate-provider";
import { buildFinalizationDryRun } from "@/lib/investor-finalization-dry-run";
import {
  buildLiveFxCoveragePreview,
  type ReliableLiveFxPosition,
  type UnsupportedLiveFxPosition,
} from "@/lib/live-fx-position-tracing";
import { isInvestorFinalizationEnabled } from "@/lib/investor-production-gate";
import { calculateHistoricalSaleProfitPkr } from "@/lib/historical-sale-profit";

function dateOnly(date: Date | string): string {
  return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
}

function parsePeriod(searchParams: URLSearchParams) {
  const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : undefined;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  if (dateFrom || dateTo) {
    return {
      year: undefined,
      periodStart: dateFrom || "1900-01-01",
      periodEnd: dateTo || new Date().toISOString().slice(0, 10),
    };
  }
  const resolvedYear = Number.isFinite(year) ? year! : new Date().getFullYear();
  return {
    year: resolvedYear,
    periodStart: `${resolvedYear}-01-01`,
    periodEnd: `${resolvedYear}-12-31`,
  };
}

function parsePeriodFromBody(body: any) {
  if (body.dateFrom || body.dateTo) {
    return {
      year: undefined,
      periodStart: String(body.dateFrom || "1900-01-01").slice(0, 10),
      periodEnd: String(body.dateTo || new Date().toISOString().slice(0, 10)).slice(0, 10),
    };
  }
  const year = Number(body.year || new Date().getFullYear());
  const resolvedYear = Number.isFinite(year) ? year : new Date().getFullYear();
  return {
    year: resolvedYear,
    periodStart: `${resolvedYear}-01-01`,
    periodEnd: `${resolvedYear}-12-31`,
  };
}

async function loadExplicitCapitalEvents(): Promise<AttributionCapitalEvent[]> {
  const participants = await prisma.investmentParticipant.findMany({
    include: { capitalEvents: { orderBy: { effectiveDate: "asc" } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return participants.flatMap((participant) =>
    participant.capitalEvents.map((event) => ({
      participantId: String(participant.id),
      participantName: participant.name,
      participantType: participant.type,
      effectiveDate: dateOnly(event.effectiveDate),
      amountPkr: Number(event.amountPkr),
      eventType: event.eventType,
      investorProfitSharePercent: event.investorProfitSharePercent == null
        ? null
        : Number(event.investorProfitSharePercent),
    }))
  );
}

async function loadExplicitProfitShareEvents(): Promise<AttributionProfitShareEvent[]> {
  const participants = await prisma.investmentParticipant.findMany({
    include: { profitShareEvents: { orderBy: { effectiveDate: "asc" } } },
  });

  return participants.flatMap((participant) =>
    participant.profitShareEvents.map((event) => ({
      participantId: String(participant.id),
      effectiveDate: dateOnly(event.effectiveDate),
      investorProfitSharePercent: Number(event.investorProfitSharePercent),
      managerProfitSharePercent: Number(event.managerProfitSharePercent),
    }))
  );
}

async function loadLegacyInvestorCapitalEvents(): Promise<AttributionCapitalEvent[]> {
  const investors = await prisma.investor.findMany({
    where: { isActive: true },
    include: {
      accounts: {
        include: {
          currency: true,
          deposits: { orderBy: { depositDate: "asc" } },
          withdrawals: { orderBy: { withdrawalDate: "asc" } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const events: AttributionCapitalEvent[] = [];
  for (const investor of investors) {
    for (const account of investor.accounts) {
      if (account.currency.code !== "PKR") continue;
      const participantId = `legacy-investor:${investor.id}:account:${account.id}`;
      const share = account.profitSharePercent == null ? 100 : Number(account.profitSharePercent);
      for (const deposit of account.deposits) {
        events.push({
          participantId,
          participantName: investor.name,
          participantType: "investor",
          effectiveDate: dateOnly(deposit.depositDate),
          amountPkr: Number(deposit.amount),
          eventType: "capital_contribution",
          investorProfitSharePercent: share,
        });
      }
      for (const withdrawal of account.withdrawals) {
        events.push({
          participantId,
          participantName: investor.name,
          participantType: "investor",
          effectiveDate: dateOnly(withdrawal.withdrawalDate),
          amountPkr: -Number(withdrawal.amount),
          eventType: "capital_withdrawal",
          investorProfitSharePercent: share,
        });
      }
    }
  }
  return events;
}

async function loadLegacyCapitalReview() {
  const investors = await prisma.investor.findMany({
    include: {
      accounts: {
        include: {
          currency: true,
          deposits: { orderBy: { depositDate: "asc" } },
          withdrawals: { orderBy: { withdrawalDate: "asc" } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return buildLegacyInvestorCapitalReview(investors.flatMap((investor) =>
    investor.accounts.map((account) => ({
      investorId: investor.id,
      investorName: investor.name,
      accountId: account.id,
      currencyCode: account.currency.code,
      accountStartDate: dateOnly(account.startDate),
      profitType: account.profitType,
      profitSharePercent: account.profitSharePercent == null ? null : Number(account.profitSharePercent),
      fixedRatePercent: account.fixedRatePercent == null ? null : Number(account.fixedRatePercent),
      transactions: [
        ...account.deposits.map((deposit) => ({
          id: deposit.id,
          type: "deposit" as const,
          date: dateOnly(deposit.depositDate),
          amountPkr: Number(deposit.amount),
          notes: deposit.notes,
        })),
        ...account.withdrawals.map((withdrawal) => ({
          id: withdrawal.id,
          type: "withdrawal" as const,
          date: dateOnly(withdrawal.withdrawalDate),
          amountPkr: Number(withdrawal.amount),
          notes: withdrawal.notes,
        })),
      ],
    }))
  ));
}

async function loadCapitalEvents() {
  const explicitEvents = await loadExplicitCapitalEvents();
  if (explicitEvents.length > 0) {
    return {
      source: "investment_capital_events",
      events: explicitEvents,
      profitShareEvents: await loadExplicitProfitShareEvents(),
    };
  }
  return { source: "legacy_investor_accounts", events: await loadLegacyInvestorCapitalEvents(), profitShareEvents: [] };
}

async function findMissingRequiredRates(periodStart: string, periodEnd: string) {
  const currencies = await prisma.currency.findMany({ select: { id: true, code: true } });
  const currencyById = new Map(currencies.map((currency) => [currency.id, currency.code.toUpperCase()]));
  const pkrCurrency = currencies.find((currency) => currency.code.toUpperCase() === "PKR");
  const countries = await prisma.country.findMany({ select: { id: true, name: true } });
  const countryNameById = new Map(countries.map((country) => [country.id, country.name]));
  const needed = new Map<string, { countryId: number; currencyCode: string; date: Date; source: string }>();
  const addNeed = (countryId: number | null | undefined, currencyCode: string | null | undefined, date: Date | null | undefined, source: string) => {
    const code = String(currencyCode || "").toUpperCase();
    if (!countryId || !date || !code || code === "PKR") return;
    needed.set(`${countryId}:${code}:${dateOnly(date)}:${source}`, { countryId, currencyCode: code, date, source });
  };

  const lots = await prisma.lot.findMany({
    where: {
      lotDate: { lte: new Date(periodEnd) },
      OR: [
        { sales: { some: { saleDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, status: "active" } } },
        { saleItems: { some: { sale: { saleDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, status: "active" } } } },
      ],
    },
    select: { id: true, lotNumber: true, countryId: true, lotDate: true, pkrExchangeRate: true },
  });

  const missing: string[] = [];
  for (const lot of lots) {
    if (Number(lot.pkrExchangeRate || 0) > 0) continue;
    const rate = await getCountryFallbackRateToPkr({
      countryId: lot.countryId,
      fromCurrencyCode: "USD",
      asOf: lot.lotDate,
    });
    if (!rate) {
      missing.push(`Missing USD→PKR fallback rate for lot ${lot.lotNumber} on ${dateOnly(lot.lotDate)}.`);
    }
  }

  const [sales, payments, expenses, withdrawals, hajiTransfers, lotCosts, supplierPayments, shippingPayments, agentPayments, intermediaryDeposits] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, status: "active" },
      select: { saleDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
    prisma.payment.findMany({
      where: { paymentDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, status: "active" },
      select: { paymentDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, deletedAt: null },
      select: { expenseDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
    prisma.personalWithdrawal.findMany({
      where: { withdrawalDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { withdrawalDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
    prisma.hajiTransfer.findMany({
      where: { transferDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { transferDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
    prisma.lotCost.findMany({
      where: { OR: [{ costDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } }, { costDate: null, lot: { lotDate: { lte: new Date(periodEnd) } } }] },
      select: { costDate: true, currencyCode: true, lot: { select: { countryId: true, lotDate: true, lotNumber: true } } },
    }),
    prisma.supplierPayment.findMany({
      where: { paymentDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { paymentDate: true, amountUsd: true, lot: { select: { countryId: true, lotNumber: true } } },
    }),
    prisma.shippingLinePayment.findMany({
      where: { paymentDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { paymentDate: true, amountUsd: true, lot: { select: { countryId: true, lotNumber: true } } },
    }),
    prisma.agentPayment.findMany({
      where: { paymentDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { paymentDate: true, currencyCode: true, city: { select: { countryId: true } } },
    }),
    prisma.intermediaryDeposit.findMany({
      where: { depositDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: { depositDate: true, currencyId: true, city: { select: { countryId: true } } },
    }),
  ]);

  for (const row of sales) addNeed(row.city.countryId, currencyById.get(row.currencyId), row.saleDate, "sale");
  for (const row of payments) addNeed(row.city.countryId, currencyById.get(row.currencyId), row.paymentDate, "customer collection");
  for (const row of expenses) addNeed(row.city.countryId, currencyById.get(row.currencyId), row.expenseDate, "expense");
  for (const row of withdrawals) addNeed(row.city.countryId, currencyById.get(row.currencyId), row.withdrawalDate, "withdrawal");
  for (const row of hajiTransfers) addNeed(row.city.countryId, currencyById.get(row.currencyId), row.transferDate, "haji transfer");
  for (const row of lotCosts) addNeed(row.lot.countryId, row.currencyCode, row.costDate || row.lot.lotDate, `lot cost ${row.lot.lotNumber}`);
  for (const row of supplierPayments) if (Number(row.amountUsd) > 0) addNeed(row.lot?.countryId, "USD", row.paymentDate, `supplier payment${row.lot ? ` lot ${row.lot.lotNumber}` : ""}`);
  for (const row of shippingPayments) if (Number(row.amountUsd) > 0) addNeed(row.lot?.countryId, "USD", row.paymentDate, `shipping payment${row.lot ? ` lot ${row.lot.lotNumber}` : ""}`);
  for (const row of agentPayments) addNeed(row.city.countryId, row.currencyCode, row.paymentDate, "agent payment");
  for (const row of intermediaryDeposits) addNeed(row.city?.countryId, currencyById.get(row.currencyId), row.depositDate, "intermediary deposit");

  const fromCurrencyByCode = new Map(currencies.map((currency) => [currency.code.toUpperCase(), currency.id]));
  for (const rateNeed of needed.values()) {
    const fromCurrencyId = fromCurrencyByCode.get(rateNeed.currencyCode);
    if (!fromCurrencyId || !pkrCurrency) continue;
    const rate = await prisma.countryFallbackExchangeRate.findFirst({
      where: {
        countryId: rateNeed.countryId,
        fromCurrencyId,
        toCurrencyId: pkrCurrency.id,
        effectiveFrom: { lte: rateNeed.date },
        isActive: true,
      },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true },
    });
    if (!rate) {
      missing.push(`Missing ${rateNeed.currencyCode}→PKR fallback rate for ${countryNameById.get(rateNeed.countryId) || `country ${rateNeed.countryId}`} on ${dateOnly(rateNeed.date)} (${rateNeed.source}).`);
    }
  }
  return missing;
}

function buildReadiness(input: {
  reconciliationDifferencePkr: number;
  missingRequiredRates: string[];
  capitalSource: string;
  finalizationDisabledReasons: string[];
}) {
  const blockers: string[] = [];
  let status = "READY";
  const block = (nextStatus: string, message: string) => {
    if (status === "READY") status = nextStatus;
    blockers.push(message);
  };
  if (Math.abs(Number(input.reconciliationDifferencePkr || 0)) > 0) {
    block("BLOCKED_RECONCILIATION", "Reconciliation difference must be exactly zero.");
  }
  if (input.missingRequiredRates.length > 0) {
    block("BLOCKED_MISSING_FX", "All required FX fallback/open-market rates must be present.");
  }
  if (input.capitalSource === "legacy_investor_accounts") {
    block("BLOCKED_UNRESOLVED_LEGACY_CAPITAL", "Legacy investor capital must be reviewed before finalization.");
  }
  const dataIntegrityReasons = input.finalizationDisabledReasons.filter((reason) => (
    !reason.includes("Missing ") &&
    !reason.includes("investor/manager capital")
  ));
  if (dataIntegrityReasons.length > 0) {
    block("BLOCKED_DATA_INTEGRITY", dataIntegrityReasons.join(" "));
  }
  return {
    status,
    finalizationButtonEnabled: false,
    blockers,
    rules: [
      "reconciliation difference = 0",
      "all required FX rates present",
      "capital participation segments valid",
      "profit-share ratios valid",
      "no data-integrity errors",
      "legacy capital reviewed and explicit before finalization",
    ],
  };
}

async function buildAttributionFinalizationPreview(user: JWTPayload, periodStart: string, periodEnd: string) {
  const [capital, missingRequiredRates, legacyCapitalReview, liveFxCoverage, existingFinalizations] = await Promise.all([
    loadCapitalEvents(),
    findMissingRequiredRates(periodStart, periodEnd),
    loadLegacyCapitalReview(),
    loadLiveFxCoverage(periodEnd),
    (prisma as any).profitAttributionPeriod.findMany({
      where: { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), status: { in: ["finalized"] } },
      select: { periodStart: true, periodEnd: true, status: true, finalizedAt: true, reversedAt: true },
    }),
  ]);
  const historicalPoolTransactions = await loadHistoricalPoolTransactions(periodStart, periodEnd, liveFxCoverage.historicalTransactions);

  const preview = await buildInvestorAttributionPreview({
    periodStart,
    periodEnd,
    capitalEvents: capital.events,
    profitShareEvents: capital.profitShareEvents,
    missingRequiredRates,
    getBusinessResult: async (segmentStart, segmentEnd) => {
      const report = await buildPeriodProfitReportData(user, undefined, segmentStart, segmentEnd);
      return {
        netBusinessProfitPkr: Number(report.profitAndLoss?.netProfit || 0),
      };
    },
  });
  const historicalPoolPreview = buildHistoricalPoolPreview({
    periodStart,
    periodEnd,
    capitalEvents: capital.events,
    profitShareEvents: capital.profitShareEvents,
    transactions: historicalPoolTransactions,
  });
  const historicalMissingRates = historicalPoolPreview.blockedReasons.filter((reason) => reason.startsWith("Missing "));
  const readiness = buildReadiness({
    reconciliationDifferencePkr: preview.reconciliationDifferencePkr,
    missingRequiredRates: [...missingRequiredRates, ...historicalMissingRates],
    capitalSource: capital.source,
    finalizationDisabledReasons: preview.finalizationDisabledReasons,
  });
  const finalizationDryRun = buildFinalizationDryRun({
    attribution: preview,
    historicalPoolPreview,
    readinessBlockers: readiness.blockers,
    missingRates: [...missingRequiredRates, ...historicalMissingRates],
    unsupportedFxPositions: liveFxCoverage.unsupportedPositions,
    existingFinalizations: existingFinalizations.map((row: any) => ({
      periodStart: dateOnly(row.periodStart),
      periodEnd: dateOnly(row.periodEnd),
      status: row.status === "finalized" ? "FINALIZED" : row.status === "reversed" ? "REVERSED" : "DRAFT",
      finalizedAt: row.finalizedAt?.toISOString() || null,
      reversedAt: row.reversedAt?.toISOString() || null,
    })),
    sourceReportReference: `financial-report:${periodStart}:${periodEnd}`,
  });

  return {
    capital,
    missingRequiredRates,
    legacyCapitalReview,
    liveFxCoverage,
    historicalPoolTransactions,
    preview,
    historicalPoolPreview,
    historicalMissingRates,
    readiness,
    finalizationDryRun,
  };
}

function requireNumericParticipantId(participantId: string) {
  const id = Number(participantId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ledgerCategoryForPosting(postingType: string) {
  if (postingType === "investor_profit_entitlement") return "investor_profit";
  if (postingType === "investor_capital_loss") return "investor_capital_loss";
  if (postingType === "manager_own_capital_result") return "manager_own_capital";
  if (postingType === "manager_profit_share") return "manager_profit_share";
  if (postingType === "exited_residual_gain" || postingType === "exited_residual_loss") return "manager_residual";
  return null;
}

function assertFinalizationEligible(input: Awaited<ReturnType<typeof buildAttributionFinalizationPreview>>) {
  const blockers = [
    ...(input.readiness.blockers || []),
    ...(input.finalizationDryRun.blockers || []).map((blocker) => `${blocker.code}: ${blocker.message}`),
  ];
  if (input.capital.source !== "investment_capital_events") {
    blockers.push("Explicit participant capital events are required before finalization.");
  }
  for (const line of input.preview.segments.flatMap((segment) => segment.lines)) {
    if (!requireNumericParticipantId(line.participantId)) {
      blockers.push(`Participant ${line.participantName} is not an explicit investment participant.`);
    }
  }
  for (const residual of input.historicalPoolPreview.residualTransfers) {
    if (!requireNumericParticipantId(residual.originalParticipantId) || !requireNumericParticipantId(residual.managerParticipantId)) {
      blockers.push(`Residual attribution ${residual.sourceType}:${residual.sourceId} is not linked to explicit numeric participants.`);
    }
  }
  if (input.finalizationDryRun.postingSimulation.reconciliation.debitCreditDifferencePkr !== 0) {
    blockers.push("Simulated postings do not balance.");
  }
  if (
    input.finalizationDryRun.postingSimulation.reconciliation.postingToSnapshotDifferencePkr !== 0 ||
    input.finalizationDryRun.postingSimulation.reconciliation.snapshotToHistoricalDifferencePkr !== 0 ||
    input.finalizationDryRun.postingSimulation.reconciliation.historicalToFinancialReportDifferencePkr !== 0
  ) {
    blockers.push("Finalization reconciliation chain is not exactly zero.");
  }
  return [...new Set(blockers)];
}

async function loadHistoricalPoolTransactions(periodStart: string, periodEnd: string, fxTransactions: HistoricalPoolTransaction[]) {
  const report = await buildPeriodProfitReportData({ role: "super_admin", userId: 0 } as JWTPayload, undefined, periodStart, periodEnd);
  const landedCostByLot = new Map<number, number>();
  for (const lot of report.lotBreakdown || []) {
    landedCostByLot.set(Number(lot.lotId), Number(lot.landedCostPerCartonPkr || lot.landedCostPerCarton || 0));
  }

  const [sales, discounts] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: new Date(periodStart), lte: new Date(periodEnd) }, status: "active" },
      include: { customer: { select: { name: true } }, currency: { select: { code: true } }, items: { include: { product: { select: { name: true } } } } },
      orderBy: { saleDate: "asc" },
    }),
    prisma.saleDiscount.findMany({
      where: { discountDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      include: { sale: { select: { id: true, voucherNo: true, saleDate: true, customer: { select: { name: true } } } } },
      orderBy: { discountDate: "asc" },
    }),
  ]);

  const transactions: HistoricalPoolTransaction[] = [];
  for (const sale of sales) {
    for (const item of sale.items) {
      const lotId = Number(item.lotId || sale.lotId);
      const saleProfit = calculateHistoricalSaleProfitPkr({
        saleId: sale.id,
        saleCurrencyCode: sale.currency.code,
        saleTotalAmount: sale.totalAmount,
        saleFxPkrEquivalent: sale.fxPkrEquivalent,
        itemAmount: item.amount,
        itemQty: item.qty,
        landedCostPerCartonPkr: landedCostByLot.get(lotId) || 0,
      });
      transactions.push({
        sourceType: "sale_profit",
        sourceId: item.id,
        recognizedDate: dateOnly(sale.saleDate),
        originalPoolDate: dateOnly(sale.saleDate),
        amountPkr: saleProfit.profitPkr,
        description: saleProfit.ok
          ? `Sale ${sale.voucherNo} · ${sale.customer.name} · ${item.product.name}`
          : saleProfit.missingReason,
      });
    }
  }
  for (const discount of discounts) {
    transactions.push({
      sourceType: "discount",
      sourceId: discount.id,
      recognizedDate: dateOnly(discount.discountDate),
      originalPoolDate: dateOnly(discount.sale.saleDate),
      amountPkr: -Number(discount.discountAmount || 0),
      description: `Discount on sale ${discount.sale.voucherNo} · ${discount.sale.customer.name}`,
    });
  }
  return [...transactions, ...fxTransactions];
}

async function findOpenMarketRateToPkr(currencyCode: string, valuationDate: string, positionKind: "asset" | "liability"): Promise<NormalizedExchangeRateResult> {
  const currencies = await prisma.currency.findMany({ select: { id: true, code: true } });
  const fromCurrency = currencies.find((currency) => currency.code.toUpperCase() === currencyCode.toUpperCase());
  const pkrCurrency = currencies.find((currency) => currency.code.toUpperCase() === "PKR");
  if (!fromCurrency || !pkrCurrency) {
    return {
      ok: false,
      provider: "MANUAL_OPEN_MARKET",
      market: "open_market",
      fromCurrencyCode: currencyCode.toUpperCase(),
      toCurrencyCode: "PKR",
      positionKind,
      missingReason: `Missing currency master data for ${currencyCode.toUpperCase()}→PKR valuation.`,
      conversionPath: [`${currencyCode.toUpperCase()}→PKR`],
      sourceRates: [],
    };
  }
  const rate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrencyId: fromCurrency.id,
      toCurrencyId: pkrCurrency.id,
      rateDate: { lte: new Date(valuationDate) },
    },
    orderBy: { rateDate: "desc" },
    select: { buyRate: true, sellRate: true, referenceRate: true, source: true, rateDate: true, createdAt: true, entryMethod: true, id: true },
  });
  if (!rate) {
    return {
      ok: false,
      provider: "MANUAL_OPEN_MARKET",
      market: "open_market",
      fromCurrencyCode: fromCurrency.code.toUpperCase(),
      toCurrencyCode: "PKR",
      positionKind,
      missingReason: `Missing ${fromCurrency.code.toUpperCase()}→PKR open-market rate for ${positionKind} valuation on ${valuationDate}.`,
      conversionPath: [`${fromCurrency.code.toUpperCase()}→PKR`],
      sourceRates: [],
    };
  }
  return selectRateForPosition(normalizeExchangeRateRow({
    provider: "MANUAL_OPEN_MARKET",
    market: rate.source || "open_market",
    fromCurrencyCode: fromCurrency.code,
    toCurrencyCode: "PKR",
    buyRate: rate.buyRate == null ? null : Number(rate.buyRate),
    sellRate: rate.sellRate == null ? null : Number(rate.sellRate),
    referenceRate: Number(rate.referenceRate),
    sourceTimestamp: rate.rateDate,
    fetchedTimestamp: rate.createdAt,
    providerReference: `exchange_rates:${rate.id}`,
    entryMethod: rate.entryMethod === "api" ? "api" : "manual",
  }), positionKind);
}

async function loadLiveFxCoverage(periodEnd: string) {
  const valuationDate = dateOnly(periodEnd);
  const usdRate = await findOpenMarketRateToPkr("USD", valuationDate, "asset");
  const usdLayers = await prisma.intermediaryUsdCostLayer.findMany({
    where: {
      acquiredDate: { lte: new Date(periodEnd) },
      remainingAmountUsd: { gt: 0 },
    },
    include: {
      intermediary: { select: { name: true } },
      currency: { select: { code: true } },
    },
    orderBy: { acquiredDate: "asc" },
  });

  const currencies = await prisma.currency.findMany({ select: { id: true, code: true } });
  const codeById = new Map(currencies.map((currency) => [currency.id, currency.code.toUpperCase()]));
  const supportedPositions: ReliableLiveFxPosition[] = usdLayers.map((layer) => ({
    sourceRecord: `intermediary_usd_cost_layers:${layer.id}`,
    sourcePosition: `${layer.intermediary.name} ${layer.currency.code.toUpperCase()} layer ${layer.id}`,
    positionType: "intermediary_balance",
    positionKind: "asset",
    currencyCode: layer.currency.code,
    foreignAmount: Number(layer.remainingAmountUsd),
    carryingPkrValue: Number(layer.remainingCostPkr),
    historicalRate: Number(layer.ratePkr),
    historicalPoolDate: dateOnly(layer.acquiredDate),
    valuationDate,
    valuationRate: usdRate,
  }));
  const nonPkrCurrencyIds = currencies
    .filter((currency) => ["AFN", "RMB", "CNY", "USD"].includes(currency.code.toUpperCase()) && currency.code.toUpperCase() !== "PKR")
    .map((currency) => currency.id);
  const deposits = await prisma.intermediaryDeposit.findMany({
    where: {
      depositDate: { lte: new Date(periodEnd) },
      currencyId: { in: nonPkrCurrencyIds },
    },
    select: { id: true, currencyId: true, depositDate: true, amount: true, intermediary: { select: { name: true } } },
    take: 25,
    orderBy: { depositDate: "asc" },
  });

  const unsupportedPositions: UnsupportedLiveFxPosition[] = deposits
    .filter((deposit) => codeById.get(deposit.currencyId) !== "USD")
    .map((deposit) => ({
      sourceRecord: `intermediary_deposits:${deposit.id}`,
      sourcePosition: `intermediary_deposit:${deposit.id}`,
      positionType: "intermediary_balance",
      positionKind: "asset",
      currencyCode: codeById.get(deposit.currencyId) || "UNKNOWN",
      foreignAmount: Number(deposit.amount || 0),
      date: dateOnly(deposit.depositDate),
      reason: `Existing ${deposit.intermediary.name} deposit is recorded, but there is no source-layer remaining-balance table for this currency yet; preview will not invent an outstanding AFN/RMB balance.`,
    }));
  return buildLiveFxCoveragePreview({ supportedPositions, unsupportedPositions });
}

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const { year, periodStart, periodEnd } = parsePeriod(request.nextUrl.searchParams);
    const {
      capital,
      missingRequiredRates,
      legacyCapitalReview,
      liveFxCoverage,
      preview,
      historicalPoolPreview,
      readiness,
      finalizationDryRun,
    } = await buildAttributionFinalizationPreview(user, periodStart, periodEnd);

    return successResponse({
      ...preview,
      year: year || null,
      capitalSource: capital.source,
      capitalSourceLabel: capital.source === "legacy_investor_accounts"
        ? "Derived from legacy investor transactions"
        : "Explicit investment capital events",
      requiredRatesStatus: missingRequiredRates.length === 0 ? "COMPLETE" : "MISSING",
      missingRequiredRates,
      readiness,
      legacyCapitalReview,
      historicalPoolPreview,
      exchangeRateProviderStatus: {
        manualOpenMarket: {
          provider: "MANUAL_OPEN_MARKET",
          status: "SUPPORTED",
          authoritative: true,
          auditedCorrectionsRequired: true,
        },
        sarafiAf: sarafiAfIntegrationStatus(),
      },
      liveFxCoverage,
      unsupportedFxPositions: liveFxCoverage.unsupportedPositions,
      finalizationDryRun,
      phase: "preview_only",
    });
  } catch (error) {
    console.error("Investor attribution preview error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    if (action === "finalize") {
      if (!isInvestorFinalizationEnabled()) return errorResponse("FEATURE_DISABLED", "Investor finalization is disabled until production enablement is approved.", 403);
      const confirmation = String(body.confirmation || "");
      if (confirmation !== "FINALIZE") return errorResponse("CONFIRMATION_REQUIRED", "Type FINALIZE to confirm period finalization.", 400);
      const { periodStart, periodEnd } = parsePeriodFromBody(body);
      const built = await buildAttributionFinalizationPreview(user, periodStart, periodEnd);
      const blockers = assertFinalizationEligible(built);
      if (blockers.length > 0) return errorResponse("FINALIZATION_BLOCKED", "Investor attribution period is not eligible for finalization.", 409, blockers);

      const result = await prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        const lockKey = `investor-finalization:${periodStart}:${periodEnd}`;
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", lockKey);
        const existing = await tx.profitAttributionPeriod.findFirst({
          where: { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), status: "finalized" },
          select: { id: true },
        });
        if (existing) {
          throw new Error("ALREADY_FINALIZED");
        }

        const period = await txAny.profitAttributionPeriod.create({
          data: {
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            status: "finalized",
            businessProfitPkr: built.preview.totalBusinessProfitPkr,
            totalAttributedPkr: built.preview.totalAttributedPkr,
            reconciliationDifferencePkr: built.finalizationDryRun.frozenPreview.reconciliationDifferencePkr,
            reconciliationStatus: built.preview.reconciliationStatus,
            finalizationDisabledReasons: [],
            sourceReportReference: built.finalizationDryRun.frozenPreview.sourceReportReference,
            snapshotJson: {
              attribution: built.preview,
              historicalPoolPreview: built.historicalPoolPreview,
              liveFxCoverage: built.liveFxCoverage,
              finalizationDryRun: built.finalizationDryRun,
            },
            postingSimulationJson: built.finalizationDryRun.postingSimulation,
            finalizedBy: user.userId,
            finalizedAt: new Date(),
            reconciliationReference: built.finalizationDryRun.concurrencyDesign.idempotencyKey,
            idempotencyKey: built.finalizationDryRun.concurrencyDesign.idempotencyKey,
            createdBy: user.userId,
          },
        });

        const lineRows = built.preview.segments.flatMap((segment) => segment.lines.map((line) => ({
          periodId: period.id,
          participantId: requireNumericParticipantId(line.participantId)!,
          segmentStart: new Date(line.segmentStart),
          segmentEnd: new Date(line.segmentEnd),
          capitalPkr: line.capitalPkr,
          capitalPercent: line.capitalPercent,
          poolProfitPkr: line.poolProfitPkr,
          attributablePkr: line.attributablePkr,
          investorProfitSharePercent: line.investorProfitSharePercent,
          managerProfitSharePercent: line.managerProfitSharePercent,
          investorEntitlementPkr: line.investorEntitlementPkr,
          managerOwnCapitalProfitPkr: line.managerOwnCapitalProfitPkr,
          managerSharePkr: line.managerSharePkr,
          allocatedLossPkr: line.allocatedLossPkr,
          totalAttributedPkr: line.totalAttributedPkr,
        })));
        if (lineRows.length > 0) await tx.profitAttributionLine.createMany({ data: lineRows });

        const residualRows = built.historicalPoolPreview.residualTransfers.map((residual) => ({
          periodId: period.id,
          originalParticipantId: requireNumericParticipantId(residual.originalParticipantId)!,
          managerParticipantId: requireNumericParticipantId(residual.managerParticipantId)!,
          sourceType: residual.sourceType,
          sourceId: Number.isInteger(Number(residual.sourceId)) ? Number(residual.sourceId) : null,
          originalCapitalPercent: residual.originalCapitalPercent,
          originalAttributablePkr: residual.originalAttributablePkr,
          managerAssumptionPkr: residual.managerAssumptionPkr,
          postingDate: new Date(residual.recognizedDate),
          notes: residual.reason,
          createdBy: user.userId,
        }));
        if (residualRows.length > 0) await tx.investorResidualAttribution.createMany({ data: residualRows });

        const ledgerRows = built.finalizationDryRun.postingSimulation.entries
          .map((entry) => ({ entry, category: ledgerCategoryForPosting(entry.postingType) }))
          .filter((row): row is { entry: typeof built.finalizationDryRun.postingSimulation.entries[number]; category: NonNullable<ReturnType<typeof ledgerCategoryForPosting>> } => Boolean(row.category))
          .map(({ entry, category }) => ({
            periodId: period.id,
            participantId: requireNumericParticipantId(entry.participantId)!,
            category,
            entryType: "finalization",
            amountPkr: entry.amountPkr,
            debitAccount: entry.debitAccount,
            creditAccount: entry.creditAccount,
            sourcePool: entry.sourcePool,
            sourceAttributionLine: entry.sourceAttributionLine,
            postingType: entry.postingType,
            reconciliationReference: entry.reconciliationReference,
            createdBy: user.userId,
          }));
        if (ledgerRows.length > 0) await txAny.investorAttributionLedgerEntry.createMany({ data: ledgerRows });

        return { periodId: period.id, ledgerEntries: ledgerRows.length };
      });

      return successResponse({
        periodStart,
        periodEnd,
        status: "FINALIZED",
        ...result,
        reconciliation: built.finalizationDryRun.postingSimulation.reconciliation,
      }, "Investor attribution period finalized.");
    }

    if (action === "reverse") {
      if (!isInvestorFinalizationEnabled()) return errorResponse("FEATURE_DISABLED", "Investor finalization reversal is disabled until production enablement is approved.", 403);
      const periodId = Number(body.periodId);
      const reason = String(body.reason || "").trim();
      if (!Number.isInteger(periodId) || periodId <= 0) return errorResponse("VALIDATION", "Valid periodId is required.", 400);
      if (!reason) return errorResponse("VALIDATION", "Reversal reason is required.", 400);

      const result = await prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::bigint)", periodId);
        const period = await txAny.profitAttributionPeriod.findUnique({
          where: { id: periodId },
          include: { ledgerEntries: true },
        });
        if (!period || period.status !== "finalized") {
          throw new Error("NOT_FINALIZED");
        }

        const reversal = await txAny.profitAttributionPeriod.create({
          data: {
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            status: "reversed",
            businessProfitPkr: Number(period.businessProfitPkr) * -1,
            totalAttributedPkr: Number(period.totalAttributedPkr) * -1,
            reconciliationDifferencePkr: 0,
            reconciliationStatus: "RECONCILED",
            finalizationDisabledReasons: [],
            sourceReportReference: period.sourceReportReference,
            snapshotJson: { reversalOfPeriodId: period.id, reason, originalSnapshot: period.snapshotJson },
            postingSimulationJson: { reversalOfPeriodId: period.id },
            finalizedBy: period.finalizedBy,
            finalizedAt: period.finalizedAt,
            reversedBy: user.userId,
            reversedAt: new Date(),
            reversalReason: reason,
            reversalOfPeriodId: period.id,
            reconciliationReference: `investor-finalization-reversal:${period.id}:${Date.now()}`,
            idempotencyKey: `investor-finalization-reversal:${period.id}:${Date.now()}`,
            createdBy: user.userId,
          },
        });

        const reversalRows = (period as any).ledgerEntries.map((entry: any) => ({
          periodId: reversal.id,
          participantId: entry.participantId,
          category: entry.category,
          entryType: "reversal",
          amountPkr: Number(entry.amountPkr) * -1,
          debitAccount: entry.creditAccount,
          creditAccount: entry.debitAccount,
          sourcePool: entry.sourcePool,
          sourceAttributionLine: entry.sourceAttributionLine,
          postingType: `reverse_${entry.postingType}`,
          reconciliationReference: `reverse:${entry.reconciliationReference}`,
          reversalOfEntryId: entry.id,
          createdBy: user.userId,
        }));
        if (reversalRows.length > 0) await txAny.investorAttributionLedgerEntry.createMany({ data: reversalRows });
        await txAny.profitAttributionPeriod.update({
          where: { id: period.id },
          data: { status: "reversed", reversedBy: user.userId, reversedAt: new Date(), reversalReason: reason },
        });
        return { reversedPeriodId: period.id, reversalPeriodId: reversal.id, reversalEntries: reversalRows.length };
      });

      return successResponse({ status: "REVERSED", ...result }, "Investor attribution period reversed.");
    }

    return errorResponse("VALIDATION", "Unsupported investor attribution action.", 400);
  } catch (error: any) {
    if (String(error?.message || "") === "ALREADY_FINALIZED") {
      return errorResponse("ALREADY_FINALIZED", "This investor attribution period is already finalized.", 409);
    }
    if (String(error?.message || "") === "NOT_FINALIZED") {
      return errorResponse("NOT_FINALIZED", "Only finalized investor attribution periods can be reversed.", 409);
    }
    console.error("Investor attribution action error:", error);
    return serverError();
  }
});
