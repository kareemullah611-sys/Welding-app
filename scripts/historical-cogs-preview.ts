import { PrismaClient } from "@prisma/client";
import { buildAuthoritativeFinancialReportResult } from "../src/lib/authoritative-financial-report";
import { computeLotLandedCostPkr } from "../src/lib/landed-cost-pkr";
import {
  getApprovedHistoricalLotRate,
  HISTORICAL_LOT_REMEDIATION_RATES,
} from "../src/lib/historical-lot-remediation";

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function assertCloneDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (!localHost || !databaseName.startsWith("welding_app_production_clone_")) {
    throw new Error(`Refusing preview outside an isolated local production clone (host=${parsed.hostname}, database=${databaseName}).`);
  }
  return { host: parsed.hostname, databaseName };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const database = assertCloneDatabase(databaseUrl);
  const prisma = new PrismaClient();

  try {
    const approvedLotNumbers = HISTORICAL_LOT_REMEDIATION_RATES.map((row) => row.lotNumber);
    const [lots, existingCogsLines, existingOpeningAdjustmentLines, saleJournalRows] = await Promise.all([
      prisma.lot.findMany({
        where: { lotNumber: { in: approvedLotNumbers } },
        include: {
          country: true,
          lotProducts: { include: { product: true } },
          lotPurchases: { include: { product: true } },
          lotCosts: true,
          saleItems: {
            where: { sale: { status: "active" } },
            include: { sale: true, product: true },
          },
        },
        orderBy: { lotDate: "asc" },
      }),
      prisma.journalEntry.findMany({
        where: { transactionId: { startsWith: "COGS-" } },
        select: { transactionId: true, lotId: true, debit: true, credit: true },
      }),
      prisma.journalEntry.findMany({
        where: { transactionId: { startsWith: "OPENING-STOCK-COST-" } },
        select: { transactionId: true, lotId: true, debit: true, credit: true },
      }),
      prisma.journalEntry.findMany({
        where: { transactionId: { startsWith: "SALE-" } },
        select: { transactionId: true },
        distinct: ["transactionId"],
      }),
    ]);
    const recognizedSaleIds = new Set(saleJournalRows.map((row) => Number(row.transactionId.replace(/^SALE-/, ""))).filter(Boolean));

    const existingCogs = new Map<string, { debit: number; credit: number }>();
    for (const line of existingCogsLines) {
      const saleId = Number(line.transactionId.replace(/^COGS-/, ""));
      if (!saleId) continue;
      const key = `${saleId}:${line.lotId || "none"}`;
      const current = existingCogs.get(key) || { debit: 0, credit: 0 };
      current.debit += number(line.debit);
      current.credit += number(line.credit);
      existingCogs.set(key, current);
    }
    const existingOpeningAdjustments = new Map<string, { debit: number; credit: number }>();
    for (const line of existingOpeningAdjustmentLines) {
      const saleId = Number(line.transactionId.replace(/^OPENING-STOCK-COST-/, ""));
      if (!saleId) continue;
      const key = `${saleId}:${line.lotId || "none"}`;
      const current = existingOpeningAdjustments.get(key) || { debit: 0, credit: 0 };
      current.debit += number(line.debit);
      current.credit += number(line.credit);
      existingOpeningAdjustments.set(key, current);
    }

    const lotResults: any[] = [];
    const proposedCogsRows: any[] = [];
    const proposedOpeningAdjustmentRows: any[] = [];
    const blockedRows: any[] = [];

    for (const lot of lots) {
      const countryCode = String(lot.country.code || "").toUpperCase();
      const approvedRate = getApprovedHistoricalLotRate(countryCode, lot.lotNumber);
      const saleLotRows = new Map<number, typeof lot.saleItems>();
      for (const item of lot.saleItems) {
        const rows = saleLotRows.get(item.saleId) || [];
        rows.push(item);
        saleLotRows.set(item.saleId, rows);
      }

      if (!approvedRate || approvedRate.recognitionDate !== dateOnly(lot.lotDate)) {
        for (const [saleId, items] of saleLotRows) {
          blockedRows.push({ saleId, lotId: lot.id, lotNumber: lot.lotNumber, reason: "APPROVED_RATE_OR_DATE_MISMATCH", itemCount: items.length });
        }
        lotResults.push({
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          country: lot.country.name,
          recognitionDate: dateOnly(lot.lotDate),
          status: "BLOCKED_RATE_MISMATCH",
        });
        continue;
      }

      const rate = approvedRate.finalRate;
      const mtProducts = new Set(lot.lotProducts.filter((row) => row.product.unitOfMeasure !== "PCS").map((row) => row.productId));
      const mtQty = lot.lotProducts.filter((row) => row.product.unitOfMeasure !== "PCS").reduce((sum, row) => sum + number(row.totalQty), 0);
      const mtPurchaseUsd = lot.lotPurchases.filter((row) => mtProducts.has(row.productId)).reduce((sum, row) => sum + number(row.totalPriceUsd), 0);
      const landed = computeLotLandedCostPkr({
        totalPurchaseUsd: mtPurchaseUsd,
        totalCartons: mtQty,
        lotCosts: lot.lotCosts,
        lotExpensesByCurrency: {},
        usdPkrRate: rate,
      });

      const pcsUnitCost = new Map<number, number>();
      for (const lotProduct of lot.lotProducts.filter((row) => row.product.unitOfMeasure === "PCS")) {
        const purchases = lot.lotPurchases.filter((row) => row.productId === lotProduct.productId);
        const pieces = purchases.reduce((sum, row) => sum + number(row.qty), 0);
        const purchaseUsd = purchases.reduce((sum, row) => sum + number(row.totalPriceUsd), 0);
        pcsUnitCost.set(lotProduct.productId, pieces > 0 ? (purchaseUsd / pieces) * rate : 0);
      }

      let soldQuantity = 0;
      let lotProposedCogs = 0;
      let lotExistingRows = 0;
      let lotProposedOpeningAdjustment = 0;
      let lotExistingOpeningAdjustmentRows = 0;
      let lotProposedOpeningAdjustmentRows = 0;
      let lotProposedCogsRows = 0;
      for (const [saleId, items] of saleLotRows) {
        const key = `${saleId}:${lot.id}`;
        const existing = existingCogs.get(key);
        const existingOpeningAdjustment = existingOpeningAdjustments.get(key);
        const sale = items[0].sale;
        let cogs = 0;
        let displayQuantity = 0;
        for (const item of items) {
          const qty = number(item.qty);
          soldQuantity += item.product.unitOfMeasure === "PCS" && number(item.product.piecesPerCarton) > 0
            ? qty / number(item.product.piecesPerCarton)
            : qty;
          displayQuantity += item.product.unitOfMeasure === "PCS" && number(item.product.piecesPerCarton) > 0
            ? qty / number(item.product.piecesPerCarton)
            : qty;
          cogs += item.product.unitOfMeasure === "PCS"
            ? qty * number(pcsUnitCost.get(item.productId))
            : qty * landed.landedCostPerCartonPkr;
        }
        cogs = round2(cogs);
        if (sale.isOpeningImport && existingOpeningAdjustment) {
          lotExistingOpeningAdjustmentRows += 1;
          continue;
        }
        if (!sale.isOpeningImport && existing) {
          lotExistingRows += 1;
          continue;
        }
        const row = {
          saleId,
          voucherNo: sale.voucherNo,
          saleDate: dateOnly(sale.saleDate),
          month: dateOnly(sale.saleDate).slice(0, 7),
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          quantitySold: round2(displayQuantity),
          proposedCogsPkr: cogs,
          journalReference: `COGS-${saleId}`,
          proposedDebit: "Cost of Goods Sold",
          proposedCredit: "Inventory",
          proposedAccountingTreatment: sale.isOpeningImport ? "OPENING_EQUITY_ADJUSTMENT" : "OPERATING_COGS",
          revenueRecognizedInAuthoritativeReport: recognizedSaleIds.has(saleId),
          preGoLiveHistoricalImport: sale.isOpeningImport,
        };
        if (sale.isOpeningImport) {
          proposedOpeningAdjustmentRows.push({
            ...row,
            journalReference: `OPENING-STOCK-COST-${saleId}`,
            proposedDebit: "Historical Stock Adjustment",
          });
          lotProposedOpeningAdjustment += cogs;
          lotProposedOpeningAdjustmentRows += 1;
        } else {
          proposedCogsRows.push(row);
          lotProposedCogs += cogs;
          lotProposedCogsRows += 1;
        }
      }

      const totalPurchaseUsd = lot.lotPurchases.reduce((sum, row) => sum + number(row.totalPriceUsd), 0);
      const displayQuantity = lot.lotProducts.reduce((sum, row) => {
        if (row.product.unitOfMeasure === "PCS") {
          const piecesPerCarton = number(row.product.piecesPerCarton);
          return sum + (piecesPerCarton > 0 ? number(row.totalQty) / piecesPerCarton : 0);
        }
        return sum + number(row.totalQty);
      }, 0);
      const pcsPurchaseBasis = lot.lotPurchases
        .filter((row) => row.product.unitOfMeasure === "PCS")
        .reduce((sum, row) => sum + number(row.totalPriceUsd) * rate, 0);

      lotResults.push({
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        country: lot.country.name,
        recognitionDate: approvedRate.recognitionDate,
        usdAmount: round2(totalPurchaseUsd),
        quantity: round2(displayQuantity),
        rawBuyRate: approvedRate.rawBuyRate,
        rawSellRate: approvedRate.rawSellRate,
        adjustmentPkr: approvedRate.adjustmentPkr,
        recognitionRate: approvedRate.finalRate,
        source: approvedRate.source,
        sourceReference: approvedRate.sourceReference,
        purchaseBasisPkr: round2(totalPurchaseUsd * rate),
        landedBasisPkr: round2(landed.totalLandedCostPkr + pcsPurchaseBasis),
        landedUnitCostPkr: round2(displayQuantity > 0 ? (landed.totalLandedCostPkr + pcsPurchaseBasis) / displayQuantity : 0),
        soldQuantity: round2(soldQuantity),
        existingCogsRows: lotExistingRows,
        existingOpeningAdjustmentRows: lotExistingOpeningAdjustmentRows,
        proposedCogsRows: lotProposedCogsRows,
        proposedOpeningAdjustmentRows: lotProposedOpeningAdjustmentRows,
        proposedCogsPkr: round2(lotProposedCogs),
        proposedOpeningAdjustmentPkr: round2(lotProposedOpeningAdjustment),
        status: "PREVIEW_READY",
      });
    }

    const missingApprovedLots = HISTORICAL_LOT_REMEDIATION_RATES.filter((approved) => (
      !lots.some((lot) => String(lot.country.code).toUpperCase() === approved.countryCode && lot.lotNumber === approved.lotNumber)
    ));
    const proposedByMonth = new Map<string, number>();
    const recognizedProposedByMonth = new Map<string, number>();
    for (const row of proposedCogsRows) {
      proposedByMonth.set(row.month, number(proposedByMonth.get(row.month)) + row.proposedCogsPkr);
      if (row.revenueRecognizedInAuthoritativeReport) {
        recognizedProposedByMonth.set(row.month, number(recognizedProposedByMonth.get(row.month)) + row.proposedCogsPkr);
      }
    }

    const monthResults = [];
    for (const month of ["2026-06", "2026-07", "2026-08"]) {
      const year = Number(month.slice(0, 4));
      const monthNumber = Number(month.slice(5, 7));
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      const report = await buildAuthoritativeFinancialReportResult({
        dateFrom: `${month}-01`,
        dateTo: `${month}-${String(lastDay).padStart(2, "0")}`,
      });
      const proposedCogs = round2(number(proposedByMonth.get(month)));
      const recognizedRevenueCogs = round2(number(recognizedProposedByMonth.get(month)));
      const current = report.profitAndLoss;
      monthResults.push({
        month,
        currentIncomplete: current,
        proposedCogsPkr: proposedCogs,
        corrected: {
          totalRevenue: current.totalRevenue,
          totalCOGS: round2(current.totalCOGS + proposedCogs),
          totalExpenses: current.totalExpenses,
          totalFxGains: current.totalFxGains,
          totalFxLosses: current.totalFxLosses,
          netProfit: round2(current.netProfit - proposedCogs),
        },
        recognizedRevenueOnlyScenario: {
          totalRevenue: current.totalRevenue,
          totalCOGS: round2(current.totalCOGS + recognizedRevenueCogs),
          totalExpenses: current.totalExpenses,
          totalFxGains: current.totalFxGains,
          totalFxLosses: current.totalFxLosses,
          netProfit: round2(current.netProfit - recognizedRevenueCogs),
        },
        openingHistoryCogsPendingPolicyPkr: round2(proposedCogs - recognizedRevenueCogs),
        remainingWarnings: report.fxWarnings.filter((warning) => !warning.startsWith("Missing COGS journal")),
      });
    }

    const cumulative = monthResults.reduce((result, row) => ({
      totalRevenue: round2(result.totalRevenue + row.corrected.totalRevenue),
      totalCOGS: round2(result.totalCOGS + row.corrected.totalCOGS),
      totalExpenses: round2(result.totalExpenses + row.corrected.totalExpenses),
      totalFxGains: round2(result.totalFxGains + row.corrected.totalFxGains),
      totalFxLosses: round2(result.totalFxLosses + row.corrected.totalFxLosses),
      netProfit: round2(result.netProfit + row.corrected.netProfit),
    }), { totalRevenue: 0, totalCOGS: 0, totalExpenses: 0, totalFxGains: 0, totalFxLosses: 0, netProfit: 0 });

    console.log(JSON.stringify({
      safety: { ...database, mode: "READ_ONLY_PREVIEW", writesPerformed: 0 },
      summary: {
        approvedLots: HISTORICAL_LOT_REMEDIATION_RATES.length,
        matchedLots: lots.length,
        missingApprovedLots,
        activeSaleLotRows: lotResults.reduce((sum, row) => sum + number(row.existingCogsRows) + number(row.existingOpeningAdjustmentRows) + number(row.proposedCogsRows) + number(row.proposedOpeningAdjustmentRows), 0) + blockedRows.length,
        existingCogsRows: lotResults.reduce((sum, row) => sum + number(row.existingCogsRows), 0),
        existingOpeningAdjustmentRows: lotResults.reduce((sum, row) => sum + number(row.existingOpeningAdjustmentRows), 0),
        proposedCogsRows: proposedCogsRows.length,
        proposedOpeningAdjustmentRows: proposedOpeningAdjustmentRows.length,
        proposedRowsWithRecognizedRevenue: proposedCogsRows.filter((row) => row.revenueRecognizedInAuthoritativeReport).length,
        preGoLiveRowsWithoutRecognizedRevenue: proposedOpeningAdjustmentRows.filter((row) => !row.revenueRecognizedInAuthoritativeReport).length,
        preGoLiveCogsPendingPolicyPkr: round2(proposedOpeningAdjustmentRows.reduce((sum, row) => sum + row.proposedCogsPkr, 0)),
        blockedRows: blockedRows.length,
        proposedCogsPkr: round2(proposedCogsRows.reduce((sum, row) => sum + row.proposedCogsPkr, 0)),
        proposedOpeningAdjustmentPkr: round2(proposedOpeningAdjustmentRows.reduce((sum, row) => sum + row.proposedCogsPkr, 0)),
      },
      lots: lotResults,
      proposedCogsRows,
      proposedOpeningAdjustmentRows,
      blockedRows,
      profitAndLoss: { months: monthResults, cumulative },
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
