import { PrismaClient } from "@prisma/client";
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  calculateSaleCogsPkr,
  journalHistoricalOpeningStockAdjustment,
  journalSaleCOGS,
  reverseJournalEntries,
} from "../src/lib/accounting";
import {
  buildHistoricalOpeningAdjustmentPlan,
  historicalOpeningAdjustmentTransactionId,
} from "../src/lib/historical-opening-accounting";
import {
  getApprovedHistoricalLotRate,
  HISTORICAL_LOT_REMEDIATION_RATES,
} from "../src/lib/historical-lot-remediation";

const CLONE_APPLY_ACK = "APPLY_TO_ISOLATED_CLONE";
const PRODUCTION_APPLY_ACK = "APPLY_APPROVED_HISTORICAL_CORRECTION_TO_PRODUCTION";
const MAX_BACKUP_AGE_MS = 6 * 60 * 60 * 1000;

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

function assertDatabaseTarget(databaseUrl: string, productionMode: boolean) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";

  if (!productionMode) {
    if (!localHost || !databaseName.startsWith("welding_app_production_clone_")) {
      throw new Error(`Refusing historical correction outside an isolated local production clone (host=${parsed.hostname}, database=${databaseName}).`);
    }
    return { host: parsed.hostname, databaseName, environment: "ISOLATED_LOCAL_CLONE" };
  }

  const expectedHost = String(process.env.HISTORICAL_CORRECTION_EXPECTED_HOST || "").trim();
  const expectedDatabase = String(process.env.HISTORICAL_CORRECTION_EXPECTED_DATABASE || "").trim();
  if (!expectedHost || !expectedDatabase) {
    throw new Error("Production mode requires HISTORICAL_CORRECTION_EXPECTED_HOST and HISTORICAL_CORRECTION_EXPECTED_DATABASE.");
  }
  if (localHost || parsed.hostname !== expectedHost || databaseName !== expectedDatabase) {
    throw new Error(`Production target mismatch (host=${parsed.hostname}, database=${databaseName}).`);
  }
  return { host: parsed.hostname, databaseName, environment: "PRODUCTION" };
}

function assertVerifiedProductionBackup(): string {
  const backupFile = String(process.env.HISTORICAL_CORRECTION_BACKUP_FILE || "").trim();
  if (!backupFile || !existsSync(backupFile)) {
    throw new Error("Production apply requires an existing HISTORICAL_CORRECTION_BACKUP_FILE.");
  }
  const backupAgeMs = Date.now() - statSync(backupFile).mtimeMs;
  if (backupAgeMs < 0 || backupAgeMs > MAX_BACKUP_AGE_MS) {
    throw new Error("Production backup must be verified and no more than six hours old.");
  }
  const verification = spawnSync("pg_restore", ["--list", backupFile], { stdio: "ignore" });
  if (verification.status !== 0) {
    throw new Error("Production backup failed pg_restore verification.");
  }
  return basename(backupFile);
}

async function buildCorrectionPlan(prisma: PrismaClient) {
  const approvedLotNumbers = HISTORICAL_LOT_REMEDIATION_RATES.map((row) => row.lotNumber);
  const [lots, sales, journals] = await Promise.all([
    prisma.lot.findMany({
      where: { lotNumber: { in: approvedLotNumbers } },
      include: { country: true },
      orderBy: [{ lotDate: "asc" }, { id: "asc" }],
    }),
    prisma.sale.findMany({
      where: {
        status: "active",
        items: { some: { lot: { lotNumber: { in: approvedLotNumbers } } } },
      },
      include: {
        items: {
          where: { lot: { lotNumber: { in: approvedLotNumbers } } },
          include: { lot: { include: { country: true } } },
        },
      },
      orderBy: [{ saleDate: "asc" }, { id: "asc" }],
    }),
    prisma.journalEntry.findMany({
      where: {
        OR: [
          { transactionId: { startsWith: "SALE-" } },
          { transactionId: { startsWith: "COGS-" } },
          { transactionId: { startsWith: "REV-SALE-" } },
          { transactionId: { startsWith: "REV-COGS-" } },
          { transactionId: { startsWith: "OPENING-STOCK-COST-" } },
        ],
      },
      select: { transactionId: true, lotId: true },
    }),
  ]);

  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const journalKeys = new Set(journals.map((row) => `${row.transactionId}:${row.lotId || "none"}`));
  const journalTransactions = new Set(journals.map((row) => row.transactionId));
  const missingLots = HISTORICAL_LOT_REMEDIATION_RATES.filter((approved) => (
    !lots.some((lot) => lot.lotNumber === approved.lotNumber && String(lot.country.code).toUpperCase() === approved.countryCode)
  ));
  const rateErrors: string[] = [];
  const lotRates = lots.map((lot) => {
    const approved = getApprovedHistoricalLotRate(String(lot.country.code).toUpperCase(), lot.lotNumber);
    if (!approved || approved.recognitionDate !== dateOnly(lot.lotDate)) {
      rateErrors.push(`${lot.lotNumber}: approved recognition rate/date mismatch`);
    }
    return { lot, approved };
  });

  const rows = [];
  for (const sale of sales) {
    const qtyByLot = sale.items.reduce((result, item) => {
      result.set(item.lotId, number(result.get(item.lotId)) + number(item.qty));
      return result;
    }, new Map<number, number>());

    for (const [lotId, totalQtySold] of qtyByLot) {
      const lot = lotById.get(lotId);
      const approved = lot
        ? getApprovedHistoricalLotRate(String(lot.country.code).toUpperCase(), lot.lotNumber)
        : null;
      if (!lot || !approved || approved.recognitionDate !== dateOnly(lot.lotDate)) {
        rateErrors.push(`Sale ${sale.id} / lot ${lotId}: approved rate unavailable`);
        continue;
      }
      const proposedCostPkr = await calculateSaleCogsPkr({
        saleId: sale.id,
        lotId,
        totalQtySold,
        usdPkrRateOverride: approved.finalRate,
      }, prisma);
      const hasSaleJournal = journalTransactions.has(`SALE-${sale.id}`);
      const hasSaleReversal = journalTransactions.has(`REV-SALE-${sale.id}`);
      const hasCogsJournal = journalKeys.has(`COGS-${sale.id}:${lotId}`);
      const hasCogsReversal = journalTransactions.has(`REV-COGS-${sale.id}`);
      const hasOpeningAdjustment = journalKeys.has(`${historicalOpeningAdjustmentTransactionId(sale.id)}:${lotId}`);
      rows.push({
        saleId: sale.id,
        voucherNo: sale.voucherNo,
        saleDate: sale.saleDate,
        cityId: sale.cityId,
        lotId,
        lotNumber: lot.lotNumber,
        isOpeningImport: sale.isOpeningImport,
        totalQtySold,
        approvedRate: approved.finalRate,
        proposedCostPkr,
        ...buildHistoricalOpeningAdjustmentPlan({
          saleId: sale.id,
          isOpeningImport: sale.isOpeningImport,
          proposedCostPkr,
          hasSaleJournal,
          hasSaleReversal,
          hasCogsJournal,
          hasCogsReversal,
          hasOpeningAdjustment,
        }),
      });
    }
  }

  const missingNormalSaleJournals = rows.filter((row) => !row.isOpeningImport && !journalTransactions.has(`SALE-${row.saleId}`));
  const zeroCostRows = rows.filter((row) => row.proposedCostPkr <= 0);
  return { lots, lotRates, rows, missingLots, rateErrors, missingNormalSaleJournals, zeroCostRows };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const productionMode = process.argv.includes("--production");
  const database = assertDatabaseTarget(databaseUrl, productionMode);
  const apply = process.argv.includes("--apply");
  const requiredAck = productionMode ? PRODUCTION_APPLY_ACK : CLONE_APPLY_ACK;
  if (apply && process.env.HISTORICAL_CORRECTION_ACK !== requiredAck) {
    throw new Error(`Set HISTORICAL_CORRECTION_ACK=${requiredAck} for this apply mode.`);
  }
  const verifiedBackup = apply && productionMode ? assertVerifiedProductionBackup() : null;

  const prisma = new PrismaClient();
  try {
    const plan = await buildCorrectionPlan(prisma);
    const blockers = [
      ...plan.missingLots.map((row) => `Missing approved lot ${row.countryCode}/${row.lotNumber}`),
      ...plan.rateErrors,
      ...plan.missingNormalSaleJournals.map((row) => `Normal sale ${row.saleId} has no authoritative SALE journal`),
      ...plan.zeroCostRows.map((row) => `Sale ${row.saleId} / lot ${row.lotNumber} has zero historical cost`),
    ];
    const summary = {
      mode: apply ? (productionMode ? "APPLY_TO_PRODUCTION" : "APPLY_TO_ISOLATED_CLONE") : "READ_ONLY_PREVIEW",
      writesPerformed: 0,
      approvedLots: HISTORICAL_LOT_REMEDIATION_RATES.length,
      matchedLots: plan.lots.length,
      saleLotRows: plan.rows.length,
      openingSaleRows: plan.rows.filter((row) => row.isOpeningImport).length,
      normalSaleRows: plan.rows.filter((row) => !row.isOpeningImport).length,
      openingAdjustmentsToPost: plan.rows.filter((row) => row.postOpeningAdjustment).length,
      operatingCogsToPost: plan.rows.filter((row) => row.postOperatingCogs).length,
      accidentalOpeningTransactionsToReverse: [...new Set(plan.rows.flatMap((row) => row.reverseTransactionIds))],
      proposedOpeningAdjustmentPkr: round2(plan.rows.filter((row) => row.postOpeningAdjustment).reduce((sum, row) => sum + row.openingAdjustmentPkr, 0)),
      proposedOperatingCogsPkr: round2(plan.rows.filter((row) => row.postOperatingCogs).reduce((sum, row) => sum + row.proposedCostPkr, 0)),
      blockers,
    };

    if (!apply || blockers.length > 0) {
      console.log(JSON.stringify({ safety: database, summary, rows: plan.rows }, null, 2));
      if (apply && blockers.length > 0) process.exitCode = 1;
      return;
    }

    const actorUsername = String(process.env.HISTORICAL_CORRECTION_USER || "superadmin");
    const actor = await prisma.user.findFirst({ where: { username: actorUsername, role: "super_admin", isActive: true }, select: { id: true } });
    if (!actor) throw new Error(`Active superadmin ${actorUsername} not found.`);

    const applied = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", "historical-opening-accounting-correction");
      let rateUpdates = 0;
      let reversals = 0;
      let openingAdjustments = 0;
      let operatingCogs = 0;

      for (const { lot, approved } of plan.lotRates) {
        if (!approved) continue;
        const metadata = {
          source: approved.source,
          sourceReference: approved.sourceReference,
          recognitionDate: approved.recognitionDate,
          rawBuyRate: approved.rawBuyRate,
          rawSellRate: approved.rawSellRate,
          businessAdjustmentPkr: approved.adjustmentPkr,
          finalRate: approved.finalRate,
          purpose: "HISTORICAL_REMEDIATION",
          correctedBy: actor.id,
          correctedAt: new Date().toISOString(),
        };
        if (number(lot.pkrExchangeRate) !== approved.finalRate || !lot.pkrExchangeRateMetadata) {
          await tx.lot.update({
            where: { id: lot.id },
            data: { pkrExchangeRate: approved.finalRate, pkrExchangeRateMetadata: metadata },
          });
          await tx.auditLog.create({
            data: {
              userId: actor.id,
              entityType: "lots",
              entityId: lot.id,
              action: "update",
              oldValues: { pkrExchangeRate: lot.pkrExchangeRate, pkrExchangeRateMetadata: lot.pkrExchangeRateMetadata || null },
              newValues: { pkrExchangeRate: approved.finalRate, pkrExchangeRateMetadata: metadata, reason: "Approved historical inventory-cost remediation" },
            },
          });
          rateUpdates += 1;
        }
      }

      const reversed = new Set<string>();
      for (const row of plan.rows) {
        for (const transactionId of row.reverseTransactionIds) {
          if (reversed.has(transactionId)) continue;
          await reverseJournalEntries(transactionId, actor.id, tx, row.saleDate);
          reversed.add(transactionId);
          reversals += 1;
        }
        if (row.postOpeningAdjustment) {
          const amount = await journalHistoricalOpeningStockAdjustment({
            saleId: row.saleId,
            lotId: row.lotId,
            totalQtySold: row.totalQtySold,
            saleDate: row.saleDate,
            cityId: row.cityId,
            createdBy: actor.id,
          }, tx);
          if (amount > 0) openingAdjustments += 1;
        } else if (row.postOperatingCogs) {
          await journalSaleCOGS({
            saleId: row.saleId,
            lotId: row.lotId,
            totalQtySold: row.totalQtySold,
            saleDate: row.saleDate,
            cityId: row.cityId,
            createdBy: actor.id,
          }, tx);
          operatingCogs += 1;
        }
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: "historical_accounting_correction",
          entityId: 0,
          action: "create",
          newValues: {
            reason: "Approved opening-history inventory and COGS correction",
            rateUpdates,
            reversals,
            openingAdjustments,
            operatingCogs,
            productionMode,
            verifiedBackup,
          },
        },
      });
      return { rateUpdates, reversals, openingAdjustments, operatingCogs };
    }, { maxWait: 10_000, timeout: 120_000 });

    console.log(JSON.stringify({
      safety: database,
      summary: {
        ...summary,
        mode: productionMode ? "APPLIED_TO_PRODUCTION" : "APPLIED_TO_ISOLATED_CLONE",
        verifiedBackup,
        writesPerformed: applied,
      },
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
