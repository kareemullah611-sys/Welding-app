import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalOpeningParticipantBalance, reverseOpeningJournals } from "@/lib/accounting";
import { loadOpeningCutoverReadiness } from "@/lib/opening-cutover";

const dateOnly = (value: unknown) => {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
};

async function latestCutover(client: any = prisma) {
  return client.openingCutover.findFirst({
    include: { participantBalances: { include: { participant: { select: { id: true, name: true, type: true, isActive: true } } }, orderBy: { participantId: "asc" } } },
    orderBy: { revision: "desc" },
  });
}

async function openingSnapshot(tx: any, cutoverId: number, financialYearId: number) {
  const sourceTypes = [
    "opening_cash", "opening_customer_balance", "opening_bank_balance", "opening_cheque",
    "opening_haji_balance", "opening_liability", "opening_city_liability", "opening_super_admin_account",
  ];
  const [cash, customers, stock, banks, cheques, haji, liabilities, cityLiabilities, inventory, superAdminAccounts, legacyEquity, participants, foreignCarryingLayers, openingJournals] = await Promise.all([
    tx.openingCash.findMany({ orderBy: { id: "asc" } }),
    tx.openingCustomerBalance.findMany({ orderBy: { id: "asc" } }),
    tx.openingStock.findMany({ orderBy: { id: "asc" } }),
    tx.openingBankBalance.findMany({ orderBy: { id: "asc" } }),
    tx.openingCheque.findMany({ orderBy: { id: "asc" } }),
    tx.openingHajiBalance.findMany({ orderBy: { id: "asc" } }),
    tx.openingLiability.findMany({ orderBy: { id: "asc" } }),
    tx.openingCityLiability.findMany({ orderBy: { id: "asc" } }),
    tx.openingInventoryValuation.findMany({ orderBy: { id: "asc" } }),
    tx.openingSuperAdminAccountBalance.findMany({ orderBy: { id: "asc" } }),
    tx.openingEquityAllocation.findMany({ orderBy: { id: "asc" } }),
    tx.openingParticipantBalance.findMany({ where: { cutoverId }, include: { participant: { select: { id: true, name: true, type: true } } }, orderBy: { participantId: "asc" } }),
    tx.foreignCurrencyCarryingLayer.findMany({ where: { sourceType: { in: sourceTypes }, status: { not: "reversed" } }, orderBy: { id: "asc" } }),
    tx.journalEntry.findMany({ where: { entityType: { startsWith: "opening_" } }, orderBy: { id: "asc" } }),
  ]);
  return JSON.parse(JSON.stringify({
    financialYearId,
    openingRecords: { cash, customers, stock, banks, cheques, haji, liabilities, cityLiabilities, inventory, superAdminAccounts, legacyEquity, participants },
    foreignCarryingLayers,
    openingJournals,
  }));
}

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const [cutover, participants] = await Promise.all([
      latestCutover(),
      prisma.investmentParticipant.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true, isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    ]);
    const readiness = cutover ? await loadOpeningCutoverReadiness(prisma, cutover.id) : null;
    return successResponse({
      cutover: cutover ? {
        id: cutover.id,
        revision: cutover.revision,
        status: cutover.status,
        cutoverDate: cutover.cutoverDate.toISOString().slice(0, 10),
        fiscalYearStart: cutover.fiscalYearStart.toISOString().slice(0, 10),
        fiscalYearEnd: cutover.fiscalYearEnd.toISOString().slice(0, 10),
        backupReference: cutover.backupReference,
        backupAcknowledged: cutover.backupAcknowledged,
        finalizedAt: cutover.finalizedAt,
        participantBalances: cutover.participantBalances.map((row: any) => ({
          id: row.id,
          participantId: row.participantId,
          participantName: row.participant.name,
          participantType: row.participant.type,
          capitalPkr: Number(row.capitalPkr),
          currentYearProfitPkr: Number(row.currentYearProfitPkr),
          ongoingLotRealizedProfitPkr: Number(row.ongoingLotRealizedProfitPkr),
          openingDate: row.openingDate.toISOString().slice(0, 10),
          notes: row.notes,
        })),
      } : null,
      participants,
      readiness: readiness ? { ready: readiness.ready, blockers: readiness.blockers, ...readiness.input } : null,
    });
  } catch (error) {
    console.error("Opening cutover load error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "save_setup") {
      const cutoverDate = dateOnly(body.cutoverDate);
      const fiscalYearStart = dateOnly(body.fiscalYearStart);
      const fiscalYearEnd = dateOnly(body.fiscalYearEnd);
      const backupReference = String(body.backupReference || "").trim();
      const backupAcknowledged = body.backupAcknowledged === true;
      if (!cutoverDate || !fiscalYearStart || !fiscalYearEnd) return errorResponse("VALIDATION", "Valid cutover and financial-year dates are required", 400);
      if (fiscalYearStart > fiscalYearEnd || cutoverDate < fiscalYearStart || cutoverDate > fiscalYearEnd) return errorResponse("VALIDATION", "Cutover date must be inside the financial year", 400);
      if (backupAcknowledged && !backupReference) return errorResponse("VALIDATION", "Backup reference is required before acknowledgement", 400);
      const saved = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-cutover"}))`;
        const current = await latestCutover(tx);
        if (current?.status === "finalized") throw new Error("OPENING_CUTOVER_FINALIZED");
        if (current?.status === "draft") {
          return tx.openingCutover.update({ where: { id: current.id }, data: {
            cutoverDate, fiscalYearStart, fiscalYearEnd, backupReference, backupAcknowledged,
            backupVerifiedBy: backupAcknowledged ? user.userId : null,
            backupVerifiedAt: backupAcknowledged ? new Date() : null,
          } });
        }
        return tx.openingCutover.create({ data: {
          revision: (current?.revision || 0) + 1, cutoverDate, fiscalYearStart, fiscalYearEnd,
          backupReference, backupAcknowledged,
          backupVerifiedBy: backupAcknowledged ? user.userId : null,
          backupVerifiedAt: backupAcknowledged ? new Date() : null,
          supersedesCutoverId: current?.id || null,
          createdBy: user.userId,
        } });
      });
      await createAuditLog(user.userId, null, "opening_cutovers", saved.id, "update", undefined, { action, backupReference, backupAcknowledged }, getClientIP(request));
      return successResponse({ id: saved.id }, "Cutover setup saved");
    }

    if (action === "save_participant_balance") {
      const participantId = Number(body.participantId);
      const capitalPkr = Number(body.capitalPkr || 0);
      const currentYearProfitPkr = Number(body.currentYearProfitPkr || 0);
      const ongoingLotRealizedProfitPkr = Number(body.ongoingLotRealizedProfitPkr || 0);
      const openingDate = dateOnly(body.openingDate);
      if (!Number.isInteger(participantId) || participantId <= 0 || !openingDate) return errorResponse("VALIDATION", "Participant and opening date are required", 400);
      if ([capitalPkr, currentYearProfitPkr, ongoingLotRealizedProfitPkr].some((amount) => !Number.isFinite(amount) || amount < 0)) return errorResponse("VALIDATION", "Opening amounts cannot be negative", 400);
      if (capitalPkr + currentYearProfitPkr + ongoingLotRealizedProfitPkr <= 0) return errorResponse("VALIDATION", "At least one opening amount is required", 400);
      const saved = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-cutover"}))`;
        const cutover = await latestCutover(tx);
        if (!cutover || cutover.status !== "draft") throw new Error("OPENING_CUTOVER_NOT_DRAFT");
        if (openingDate < cutover.fiscalYearStart || openingDate > cutover.cutoverDate) throw new Error("OPENING_DATE_OUTSIDE_FINANCIAL_YEAR");
        const participant = await tx.investmentParticipant.findFirst({ where: { id: participantId, isActive: true }, include: { capitalEvents: { take: 1 } } });
        if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
        if (participant.capitalEvents.length) throw new Error("PARTICIPANT_ALREADY_HAS_CAPITAL_HISTORY");
        const existing = await tx.openingParticipantBalance.findUnique({ where: { opening_participant_cutover_participant_key: { cutoverId: cutover.id, participantId } } });
        const row = existing
          ? await tx.openingParticipantBalance.update({ where: { id: existing.id }, data: { capitalPkr, currentYearProfitPkr, ongoingLotRealizedProfitPkr, openingDate, notes: String(body.notes || "").trim() || null, journalVersion: existing.journalVersion + 1 } })
          : await tx.openingParticipantBalance.create({ data: { cutoverId: cutover.id, participantId, capitalPkr, currentYearProfitPkr, ongoingLotRealizedProfitPkr, openingDate, notes: String(body.notes || "").trim() || null, createdBy: user.userId } });
        if (existing) await reverseOpeningJournals("opening_participant_balance", row.id, `OPENPART-${row.id}`, user.userId, tx);
        await journalOpeningParticipantBalance({ id: row.id, participantId, participantName: participant.name, capitalPkr, currentYearProfitPkr, ongoingLotRealizedProfitPkr, openingDate, createdBy: user.userId, journalVersion: row.journalVersion }, tx);
        return row;
      });
      await createAuditLog(user.userId, null, "opening_participant_balances", saved.id, "update", undefined, { participantId, capitalPkr, currentYearProfitPkr, ongoingLotRealizedProfitPkr }, getClientIP(request));
      return successResponse({ id: saved.id }, "Participant opening balance saved");
    }

    if (action === "delete_participant_balance") {
      const id = Number(body.id);
      const deleted = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-cutover"}))`;
        const row = await tx.openingParticipantBalance.findUnique({ where: { id }, include: { cutover: true } });
        if (!row || row.cutover.status !== "draft") throw new Error("OPENING_CUTOVER_NOT_DRAFT");
        await reverseOpeningJournals("opening_participant_balance", row.id, `OPENPART-${row.id}`, user.userId, tx);
        await tx.openingParticipantBalance.delete({ where: { id } });
        return row;
      });
      await createAuditLog(user.userId, null, "opening_participant_balances", deleted.id, "delete", { participantId: deleted.participantId }, undefined, getClientIP(request));
      return successResponse({ id }, "Participant opening balance removed");
    }

    if (action === "finalize") {
      const confirmation = String(body.confirmation || "");
      if (confirmation !== "FINALIZE OPENINGS") return errorResponse("VALIDATION", "Type FINALIZE OPENINGS to confirm", 400);
      const finalized = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-cutover"}))`;
        const cutover = await latestCutover(tx);
        if (!cutover || cutover.status !== "draft") throw new Error("OPENING_CUTOVER_ALREADY_FINALIZED");
        const readiness = await loadOpeningCutoverReadiness(tx, cutover.id);
        if (!readiness?.ready) {
          const error = new Error("OPENING_CUTOVER_NOT_READY");
          (error as any).blockers = readiness?.blockers || [];
          throw error;
        }
        const financialYear = await tx.financialYear.upsert({
          where: { startDate_endDate: { startDate: cutover.fiscalYearStart, endDate: cutover.fiscalYearEnd } },
          update: {},
          create: {
            name: `FY ${cutover.fiscalYearStart.toISOString().slice(0, 10)} to ${cutover.fiscalYearEnd.toISOString().slice(0, 10)}`,
            startDate: cutover.fiscalYearStart,
            endDate: cutover.fiscalYearEnd,
            status: "open",
            createdBy: user.userId,
          },
        });
        for (const balance of cutover.participantBalances) {
          if (Number(balance.capitalPkr) <= 0) continue;
          const duplicate = await tx.investmentCapitalEvent.findFirst({ where: { participantId: balance.participantId, sourceType: "opening_cutover_finalization", sourceId: cutover.id } });
          if (!duplicate) await tx.investmentCapitalEvent.create({ data: {
            participantId: balance.participantId, eventType: "opening", amountPkr: balance.capitalPkr,
            effectiveDate: balance.openingDate, sourceType: "opening_cutover_finalization", sourceId: cutover.id,
            reason: `One-time opening cutover revision ${cutover.revision}`, createdBy: user.userId,
          } });
        }
        const snapshot = await openingSnapshot(tx, cutover.id, financialYear.id);
        return tx.openingCutover.update({ where: { id: cutover.id }, data: {
          status: "finalized", reconciliationDifferencePkr: readiness.input.openingClearingPkr,
          readinessSnapshotJson: { input: readiness.input, blockers: readiness.blockers } as any,
          finalSnapshotJson: snapshot as any, finalizedBy: user.userId, finalizedAt: new Date(),
        } });
      });
      await createAuditLog(user.userId, null, "opening_cutovers", finalized.id, "update", undefined, { action: "finalize", revision: finalized.revision }, getClientIP(request));
      return successResponse({ id: finalized.id, status: "finalized" }, "Opening cutover finalized and locked");
    }

    if (action === "reverse") {
      const confirmation = String(body.confirmation || "");
      const reason = String(body.reason || "").trim();
      if (confirmation !== "REVERSE OPENINGS" || !reason) return errorResponse("VALIDATION", "Reason and REVERSE OPENINGS confirmation are required", 400);
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-cutover"}))`;
        const cutover = await latestCutover(tx);
        if (!cutover || cutover.status !== "finalized") throw new Error("OPENING_CUTOVER_NOT_FINALIZED");
        const [laterJournal, laterAttribution, participantAction] = await Promise.all([
          tx.journalEntry.findFirst({
            where: { entryDate: { gte: cutover.cutoverDate }, NOT: [{ entityType: { startsWith: "opening_" } }, { transactionId: { startsWith: "REV-OPEN" } }] },
            select: { id: true, transactionId: true },
          }),
          tx.profitAttributionPeriod.findFirst({ where: { status: "finalized", periodEnd: { gte: cutover.cutoverDate } }, select: { id: true } }),
          tx.investmentParticipantAction.findFirst({ where: { status: "active", effectiveDate: { gte: cutover.cutoverDate } }, select: { id: true } }),
        ]);
        if (laterJournal || laterAttribution || participantAction) throw new Error("OPENING_REVERSAL_DEPENDENCIES_EXIST");
        for (const balance of cutover.participantBalances) {
          await reverseOpeningJournals("opening_participant_balance", balance.id, `OPENPART-${balance.id}`, user.userId, tx);
          if (Number(balance.capitalPkr) > 0) await tx.investmentCapitalEvent.create({ data: {
            participantId: balance.participantId, eventType: "capital_withdrawal", amountPkr: -Number(balance.capitalPkr),
            effectiveDate: cutover.cutoverDate, sourceType: "opening_cutover_reversal", sourceId: cutover.id,
            reason, createdBy: user.userId,
          } });
        }
        await tx.openingCutover.update({ where: { id: cutover.id }, data: { status: "reversed", reversedBy: user.userId, reversedAt: new Date(), reversalReason: reason } });
        const draft = await tx.openingCutover.create({ data: {
          revision: cutover.revision + 1, status: "draft", cutoverDate: cutover.cutoverDate,
          fiscalYearStart: cutover.fiscalYearStart, fiscalYearEnd: cutover.fiscalYearEnd,
          backupReference: "", backupAcknowledged: false, supersedesCutoverId: cutover.id, createdBy: user.userId,
        } });
        return { reversedId: cutover.id, draftId: draft.id };
      });
      await createAuditLog(user.userId, null, "opening_cutovers", result.reversedId, "update", undefined, { action: "reverse", reason, replacementDraftId: result.draftId }, getClientIP(request));
      return successResponse(result, "Opening cutover reversed; a new audited draft is ready for correction");
    }

    return errorResponse("VALIDATION", "Unknown cutover action", 400);
  } catch (error: any) {
    if (error?.message === "OPENING_CUTOVER_NOT_READY") return errorResponse("OPENING_CUTOVER_NOT_READY", `Opening cutover is blocked: ${(error.blockers || []).join("; ")}`, 409);
    const known: Record<string, string> = {
      OPENING_CUTOVER_FINALIZED: "Opening cutover is already finalized and locked",
      OPENING_CUTOVER_NOT_DRAFT: "No editable draft cutover exists",
      OPENING_DATE_OUTSIDE_FINANCIAL_YEAR: "Participant opening date must be inside the approved financial year and on or before the cutover date",
      PARTICIPANT_NOT_FOUND: "Active participant not found",
      PARTICIPANT_ALREADY_HAS_CAPITAL_HISTORY: "Participant already has capital history; remove test history before the fresh cutover",
      OPENING_CUTOVER_ALREADY_FINALIZED: "Opening cutover is already finalized",
      OPENING_CUTOVER_NOT_FINALIZED: "No finalized opening cutover is available to reverse",
      OPENING_REVERSAL_DEPENDENCIES_EXIST: "Opening reversal is blocked because later journals, attribution, or participant actions depend on it",
    };
    if (known[error?.message]) return errorResponse("VALIDATION", known[error.message], 409);
    console.error("Opening cutover save error:", error);
    return serverError();
  }
});
