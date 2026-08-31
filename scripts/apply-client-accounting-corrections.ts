import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CORRECTION_LOCK_KEY = 8_291_700_001n;

type Correction = {
  correctionType: string;
  source: Record<string, any>;
  originalJournal: Array<Record<string, any>>;
  proposedReversal: Array<Record<string, any>>;
  proposedCorrectedJournal: Array<Record<string, any>>;
  proposedSourceUpdate?: Record<string, any> | null;
  auditLinkage: Record<string, string>;
  status: string;
};

function arg(name: string, required = true): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || null;
  if (required && !value) throw new Error(`--${name} is required.`);
  return value;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid monetary value: ${String(value)}`);
  return parsed;
}

function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid accounting date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

function assertTarget(
  databaseUrl: string,
  acknowledgedDatabase: string,
  acknowledgedHost: string | null,
  expectedCount: number,
  allowProductionWrite: boolean,
  productionAcknowledgement: string | null,
) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (acknowledgedDatabase !== database) {
    throw new Error(`Database acknowledgement mismatch: expected ${database}.`);
  }
  if (local) {
    if (!database.startsWith("welding_app_production_clone_")) {
      throw new Error(`Refusing correction outside ISOLATED_LOCAL_CLONE (host=${parsed.hostname}, database=${database}).`);
    }
    return { host: parsed.hostname, database, environment: "ISOLATED_LOCAL_CLONE" as const };
  }

  const expectedProductionAcknowledgement = `I_ACKNOWLEDGE_${database}_${expectedCount}_CORRECTIONS`;
  if (
    !allowProductionWrite ||
    acknowledgedHost !== parsed.hostname ||
    productionAcknowledgement !== expectedProductionAcknowledgement
  ) {
    throw new Error("Refusing production correction without exact host, database, count, and production acknowledgement.");
  }
  return { host: parsed.hostname, database, environment: "PRODUCTION" as const };
}

function assertExactFile(path: string, expectedSha256: string, label: string) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} file does not exist: ${path}`);
  const actualSha256 = sha256File(path);
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch.`);
  }
  return actualSha256;
}

function assertInverse(original: Record<string, any>, reversal: Record<string, any>) {
  if (
    original.id !== reversal.id ||
    original.accountId !== reversal.accountId ||
    original.currencyCode !== reversal.currencyCode ||
    original.entryDate !== reversal.entryDate ||
    round2(amount(original.debit)) !== round2(amount(reversal.credit)) ||
    round2(amount(original.credit)) !== round2(amount(reversal.debit))
  ) {
    throw new Error(`Reversal does not exactly invert journal line ${original.id}.`);
  }
}

function assertBalanced(lines: Array<Record<string, any>>, label: string) {
  if (lines.length === 0) return;
  if (lines.some((line) => line.currencyCode !== "PKR")) throw new Error(`${label} must be entirely PKR.`);
  const debits = round2(lines.reduce((sum, line) => sum + amount(line.debit || 0), 0));
  const credits = round2(lines.reduce((sum, line) => sum + amount(line.credit || 0), 0));
  if (Math.abs(debits - credits) > 0.01) throw new Error(`${label} is unbalanced by PKR ${round2(debits - credits)}.`);
}

function validatePreview(preview: any, expectedCount: number): Correction[] {
  if (preview.mode !== "READ_ONLY_PREVIEW" || preview.writesPerformed !== 0) throw new Error("Preview is not an approved read-only artifact.");
  if (!Array.isArray(preview.corrections) || preview.corrections.length !== expectedCount) {
    throw new Error(`Expected exactly ${expectedCount} corrections.`);
  }
  if (preview.summary?.blocked !== 0 || preview.summary?.readyForApproval !== expectedCount) {
    throw new Error("Preview contains blocked or unapproved corrections.");
  }

  const transactionIds = new Set<string>();
  for (const correction of preview.corrections as Correction[]) {
    if (correction.status !== "READY_FOR_APPROVAL") throw new Error("Every correction must be READY_FOR_APPROVAL.");
    if (correction.proposedReversal.length !== correction.originalJournal.length && correction.correctionType !== "duplicate_personal_expense_correction") {
      throw new Error(`${correction.correctionType} does not reverse every original journal line.`);
    }
    if (correction.proposedReversal.length > 0) {
      correction.originalJournal.forEach((line, index) => assertInverse(line, correction.proposedReversal[index]));
    }
    assertBalanced(correction.proposedCorrectedJournal, correction.correctionType);
    for (const transactionId of Object.values(correction.auditLinkage).filter((value) => value.startsWith("CORR-"))) {
      if (transactionIds.has(transactionId)) throw new Error(`Duplicate proposed correction reference: ${transactionId}`);
      transactionIds.add(transactionId);
    }
    if (["purchase_basis_correction", "supplier_settlement_correction"].includes(correction.correctionType) && !correction.proposedSourceUpdate) {
      throw new Error(`${correction.correctionType} is missing proposedSourceUpdate.`);
    }
  }
  return preview.corrections;
}

function sameDate(value: Date, expected: string): boolean {
  return value.toISOString().slice(0, 10) === expected;
}

async function verifyOriginalJournals(tx: Prisma.TransactionClient, corrections: Correction[]) {
  const expected = corrections.flatMap((correction) => correction.originalJournal);
  const ids = expected.map((line) => Number(line.id));
  const rows = await tx.journalEntry.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const line of expected) {
    const row = byId.get(Number(line.id));
    if (!row || row.transactionId !== line.transactionId || row.accountId !== Number(line.accountId) ||
      round2(Number(row.debit)) !== round2(amount(line.debit)) || round2(Number(row.credit)) !== round2(amount(line.credit)) ||
      row.currencyCode !== line.currencyCode || !sameDate(row.entryDate, line.entryDate) || row.entityType !== line.entityType ||
      row.entityId !== line.entityId || row.lotId !== line.lotId) {
      throw new Error(`SOURCE_DRIFT: journal line ${line.id} no longer matches the approved preview.`);
    }
  }
}

async function verifySources(tx: Prisma.TransactionClient, corrections: Correction[]) {
  for (const correction of corrections) {
    if (correction.correctionType === "purchase_basis_correction") {
      const purchase = await tx.lotPurchase.findUnique({ where: { id: Number(correction.source.purchaseId) } });
      if (!purchase || purchase.lotId !== Number(correction.source.lotId) || round2(Number(purchase.totalPriceUsd)) !== round2(amount(correction.source.totalUsd))) {
        throw new Error(`SOURCE_DRIFT: purchase ${correction.source.purchaseId} no longer matches.`);
      }
    } else if (correction.correctionType === "orphan_purchase_journal") {
      const sourceCount = await tx.lotPurchase.count({ where: { id: { in: correction.source.entityIds.map(Number) } } });
      if (sourceCount !== 0) throw new Error(`SOURCE_DRIFT: orphan ${correction.source.transactionId} now has a source purchase.`);
    } else if (correction.correctionType === "supplier_settlement_correction") {
      const payment = await tx.supplierPayment.findUnique({ where: { id: Number(correction.source.paymentId) } });
      if (!payment || round2(Number(payment.amountUsd)) !== round2(amount(correction.source.amountUsd)) ||
        round2(Number(payment.amountLocal)) !== round2(amount(correction.source.actualSettlementPkr)) || !sameDate(payment.paymentDate, correction.source.paymentDate)) {
        throw new Error(`SOURCE_DRIFT: supplier payment ${correction.source.paymentId} no longer matches.`);
      }
    } else if (correction.correctionType === "duplicate_personal_expense_correction") {
      const expense = await tx.superAdminPersonalExpense.findUnique({ where: { id: Number(correction.source.expenseId) } });
      const authoritativeAmount = expense?.deletedAt ? 0 : Number(expense?.amount || 0);
      if (!expense || round2(authoritativeAmount) !== round2(amount(correction.source.authoritativeAmountPkr))) {
        throw new Error(`SOURCE_DRIFT: personal expense ${correction.source.expenseId} no longer matches.`);
      }
    } else {
      throw new Error(`Unsupported correction type: ${correction.correctionType}`);
    }
  }
}

async function resolveAccountId(tx: Prisma.TransactionClient, line: Record<string, any>): Promise<number> {
  if (line.accountId) {
    const account = await tx.account.findUnique({ where: { id: Number(line.accountId) } });
    if (!account || account.code !== line.accountCode) throw new Error(`Account mismatch for ${line.accountCode}.`);
    return account.id;
  }
  if (!['FX-GAIN', 'FX-LOSS'].includes(line.accountCode)) throw new Error(`Missing account ID for ${line.accountCode}.`);
  const account = await tx.account.upsert({
    where: { code: line.accountCode },
    update: {},
    create: {
      code: line.accountCode,
      name: line.accountCode === "FX-GAIN" ? "Foreign Exchange Gain" : "Foreign Exchange Loss",
      accountType: line.accountCode === "FX-GAIN" ? "revenue" : "expense",
    },
  });
  return account.id;
}

function correctedContext(correction: Correction) {
  const first = correction.originalJournal[0];
  if (correction.correctionType === "purchase_basis_correction") {
    return { entryDate: correction.source.recognitionDate, entityType: "lot_purchase", entityId: Number(correction.source.purchaseId), lotId: Number(correction.source.lotId), cityId: first.cityId ?? null };
  }
  if (correction.correctionType === "supplier_settlement_correction") {
    return { entryDate: correction.source.paymentDate, entityType: "supplier_payment", entityId: Number(correction.source.paymentId), lotId: first.lotId ?? null, cityId: first.cityId ?? null };
  }
  return { entryDate: first.entryDate, entityType: "super_admin_personal_expense", entityId: Number(correction.source.expenseId), lotId: null, cityId: first.cityId ?? null };
}

async function postCorrection(tx: Prisma.TransactionClient, correction: Correction, createdBy: number) {
  if (correction.proposedReversal.length > 0) {
    const transactionId = correction.proposedReversal[0].transactionId;
    const rows = [];
    for (let index = 0; index < correction.proposedReversal.length; index += 1) {
      const line = correction.proposedReversal[index];
      rows.push({
        transactionId,
        lineNumber: index + 1,
        accountId: await resolveAccountId(tx, line),
        debit: amount(line.debit),
        credit: amount(line.credit),
        currencyCode: line.currencyCode,
        exchangeRate: line.exchangeRate,
        description: `Historical correction reversal: ${line.description || line.transactionId}`,
        entityType: line.entityType,
        entityId: line.entityId,
        lotId: line.lotId,
        cityId: line.cityId,
        entryDate: dateOnly(line.entryDate),
        createdBy,
      });
    }
    await tx.journalEntry.createMany({ data: rows });
  }

  if (correction.proposedCorrectedJournal.length > 0) {
    const transactionId = correction.proposedCorrectedJournal[0].transactionId;
    const context = correctedContext(correction);
    const rows = [];
    for (let index = 0; index < correction.proposedCorrectedJournal.length; index += 1) {
      const line = correction.proposedCorrectedJournal[index];
      rows.push({
        transactionId,
        lineNumber: index + 1,
        accountId: await resolveAccountId(tx, line),
        debit: amount(line.debit),
        credit: amount(line.credit),
        currencyCode: "PKR",
        exchangeRate: 1,
        description: `Approved historical correction: ${correction.correctionType}`,
        entityType: context.entityType,
        entityId: context.entityId,
        lotId: context.lotId,
        cityId: context.cityId,
        entryDate: dateOnly(context.entryDate),
        createdBy,
      });
    }
    await tx.journalEntry.createMany({ data: rows });
  }
}

async function updateSource(tx: Prisma.TransactionClient, correction: Correction) {
  const update = correction.proposedSourceUpdate;
  if (!update) return;
  if (correction.correctionType === "purchase_basis_correction") {
    await tx.lotPurchase.update({
      where: { id: Number(correction.source.purchaseId) },
      data: {
        carryingRatePkr: amount(update.carryingRatePkr),
        carryingAmountPkr: amount(update.carryingAmountPkr),
        recognitionDate: dateOnly(update.recognitionDate),
        recognitionRateMetadata: update.recognitionRateMetadata,
      },
    });
  } else if (correction.correctionType === "supplier_settlement_correction") {
    await tx.supplierPayment.update({
      where: { id: Number(correction.source.paymentId) },
      data: {
        carryingRatePkr: amount(update.carryingRatePkr),
        carryingAmountPkr: amount(update.carryingAmountPkr),
        realizedFxPkr: amount(update.realizedFxPkr),
        fxPoolDate: dateOnly(update.fxPoolDate),
      },
    });
  }
}

function correctionEntityId(correction: Correction): number {
  return Number(correction.source.purchaseId || correction.source.paymentId || correction.source.expenseId || correction.source.entityIds?.[0] || 0);
}

async function main() {
  if (!process.argv.includes("--execute")) throw new Error("--execute is required; dry-run work belongs in client-accounting-remediation-preview.ts.");
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const expectedCount = Number(arg("expected-count")!);
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) throw new Error("--expected-count must be a positive integer.");
  const target = assertTarget(
    databaseUrl,
    arg("acknowledge-database")!,
    arg("acknowledge-host", false),
    expectedCount,
    process.argv.includes("--allow-production-write"),
    arg("acknowledge-production", false),
  );
  const previewPath = arg("preview")!;
  const previewSha256 = assertExactFile(previewPath, arg("preview-sha256")!, "Preview");
  const backupPath = arg("backup")!;
  const backupSha256 = assertExactFile(backupPath, arg("backup-sha256")!, "Backup");
  const corrections = validatePreview(JSON.parse(readFileSync(previewPath, "utf8")), expectedCount);
  const approvedBy = arg("approved-by")!;

  const result = await prisma.$transaction(async (tx) => {
    const connectedDatabaseRows = await tx.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    const connectedDatabase = connectedDatabaseRows[0]?.database;
    if (connectedDatabase !== target.database) {
      throw new Error(`Connected database mismatch: expected ${target.database}, received ${connectedDatabase || "unknown"}.`);
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CORRECTION_LOCK_KEY})`;
    const user = await tx.user.findUnique({ where: { username: approvedBy } });
    if (!user || user.role !== "super_admin") throw new Error("Approver must be an existing superadmin.");

    const proposedIds = [...new Set(corrections.flatMap((correction) => [
      ...correction.proposedReversal.map((line) => String(line.transactionId)),
      ...correction.proposedCorrectedJournal.map((line) => String(line.transactionId)),
    ]))];
    const existingCorrections = await tx.journalEntry.count({ where: { transactionId: { in: proposedIds } } });
    if (existingCorrections > 0) throw new Error("CORRECTION_ALREADY_EXISTS: refusing duplicate or partial correction run.");

    await verifyOriginalJournals(tx, corrections);
    await verifySources(tx, corrections);

    for (const correction of corrections) {
      await postCorrection(tx, correction, user.id);
      await updateSource(tx, correction);
      await tx.auditLog.create({
        data: {
          userId: user.id,
          cityId: null,
          entityType: "accounting_correction",
          entityId: correctionEntityId(correction),
          action: "update",
          oldValues: { correctionType: correction.correctionType, source: correction.source, originalJournalIds: correction.originalJournal.map((line) => line.id) },
          newValues: { previewSha256, backupPath, backupSha256, auditLinkage: correction.auditLinkage, proposedSourceUpdate: correction.proposedSourceUpdate || null },
        },
      });
    }

    return {
      correctionsApplied: corrections.length,
      journalLinesCreated: corrections.reduce((sum, correction) => sum + correction.proposedReversal.length + correction.proposedCorrectedJournal.length, 0),
      sourceRecordsUpdated: corrections.filter((correction) => correction.proposedSourceUpdate).length,
      auditRowsCreated: corrections.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });

  const report = { mode: "CONTROLLED_CORRECTION_EXECUTION", target, previewPath, previewSha256, backupPath, backupSha256, approvedBy, completedAt: new Date().toISOString(), ...result };
  const outputPath = arg("output", false);
  if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
