import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  ParticipantActionType,
  consumeProfitSources,
  loadParticipantBalance,
  round2,
  validateParticipantAction,
} from "@/lib/investor-participant-actions";
import { isInvestorSettlementEnabled } from "@/lib/investor-production-gate";

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? round2(amount) : 0;
}

function actionCapitalEventType(actionType: ParticipantActionType, capitalAmountPkr: number) {
  if (actionType === "profit_reinvestment") return "profit_reinvestment";
  if (capitalAmountPkr > 0) return "capital_withdrawal";
  return null;
}

function settlementFieldsFor(actionType: ParticipantActionType, totalAmountPkr: number) {
  if (["profit_withdrawal", "capital_withdrawal", "mixed_withdrawal"].includes(actionType) && totalAmountPkr > 0) {
    return { settledAmountPkr: 0, remainingSettlementPkr: totalAmountPkr, settlementStatus: "unsettled" };
  }
  return { settledAmountPkr: 0, remainingSettlementPkr: 0, settlementStatus: actionType === "reversal" ? "reversed" : "settled" };
}

function ledgerRowsForAction(input: {
  actionId: number;
  participantId: number;
  actionType: ParticipantActionType;
  profitAmountPkr: number;
  capitalAmountPkr: number;
  consumedSources: any[];
  idempotencyKey: string;
  userId: number;
}) {
  const rows: any[] = [];
  const base = {
    actionId: input.actionId,
    participantId: input.participantId,
    createdBy: input.userId,
  };
  if (["profit_withdrawal", "mixed_withdrawal"].includes(input.actionType) && input.profitAmountPkr > 0) {
    rows.push({
      ...base,
      category: "finalized_profit_withdrawal",
      amountPkr: input.profitAmountPkr,
      debitAccount: "Investor Profit Payable",
      creditAccount: "Investor Settlement Clearing",
      sourceFinalizationIds: input.consumedSources,
      reconciliationReference: `${input.idempotencyKey}:profit_withdrawal`,
    });
  }
  if (["capital_withdrawal", "mixed_withdrawal"].includes(input.actionType) && input.capitalAmountPkr > 0) {
    rows.push({
      ...base,
      category: "capital_withdrawal",
      amountPkr: input.capitalAmountPkr,
      debitAccount: "Investor Capital",
      creditAccount: "Investor Settlement Clearing",
      sourceFinalizationIds: [],
      reconciliationReference: `${input.idempotencyKey}:capital_withdrawal`,
    });
  }
  if (input.actionType === "profit_reinvestment" && input.profitAmountPkr > 0) {
    rows.push({
      ...base,
      category: "profit_reinvestment",
      amountPkr: input.profitAmountPkr,
      debitAccount: "Investor Profit Payable",
      creditAccount: "Investor Capital",
      sourceFinalizationIds: input.consumedSources,
      reconciliationReference: `${input.idempotencyKey}:profit_reinvestment`,
    });
  }
  if (input.actionType === "full_exit") {
    if (input.profitAmountPkr > 0) {
      rows.push({
        ...base,
        category: "full_exit_profit",
        amountPkr: input.profitAmountPkr,
        debitAccount: "Investor Profit Payable",
        creditAccount: "Investor Settlement Clearing",
        sourceFinalizationIds: input.consumedSources,
        reconciliationReference: `${input.idempotencyKey}:full_exit_profit`,
      });
    }
    if (input.capitalAmountPkr > 0) {
      rows.push({
        ...base,
        category: "full_exit_capital",
        amountPkr: input.capitalAmountPkr,
        debitAccount: "Investor Capital",
        creditAccount: "Investor Settlement Clearing",
        sourceFinalizationIds: [],
        reconciliationReference: `${input.idempotencyKey}:full_exit_capital`,
      });
    }
  }
  return rows;
}

async function hasFinalizedAttributionOnOrAfter(client: any, effectiveDate: Date) {
  return client.profitAttributionPeriod.findFirst({
    where: { status: "finalized", periodEnd: { gte: effectiveDate } },
    select: { id: true, periodStart: true, periodEnd: true },
  });
}

export const GET = withAuth(async (_request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    if (!participantId) return errorResponse("VALIDATION", "Participant is required", 400);
    const [balance, actions] = await Promise.all([
      loadParticipantBalance(participantId),
      (prisma as any).investmentParticipantAction.findMany({
        where: { participantId },
        include: { ledgerEntries: true, capitalEvent: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ]);
    return successResponse({ balance, actions });
  } catch (error) {
    console.error("Investment participant actions list error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  if (!isInvestorSettlementEnabled()) return errorResponse("FEATURE_DISABLED", "Investor settlement actions are disabled until production enablement is approved.", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const body = await request.json();
    const actionType = String(body.actionType || "") as ParticipantActionType;
    const effectiveDate = parseDate(body.effectiveDate);
    const idempotencyKey = String(body.idempotencyKey || body.confirmationReference || "").trim();
    const confirmationReference = String(body.confirmationReference || idempotencyKey || "").trim();
    const remarks = String(body.remarks || "").trim() || null;

    if (!participantId) return errorResponse("VALIDATION", "Participant is required", 400);
    if (!["profit_withdrawal", "capital_withdrawal", "mixed_withdrawal", "profit_reinvestment", "full_exit", "reversal"].includes(actionType)) {
      return errorResponse("VALIDATION", "Invalid investor action type", 400);
    }
    if (!effectiveDate) return errorResponse("VALIDATION", "Effective date is required", 400);
    if (!idempotencyKey) return errorResponse("VALIDATION", "Idempotency/reference key is required", 400);
    if (String(body.confirmation || "") !== "CONFIRM") return errorResponse("VALIDATION", "Explicit CONFIRM confirmation is required", 400);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`investment-participant-action:${participantId}`}::text)::bigint)`;

      const duplicate = await (tx as any).investmentParticipantAction.findUnique({ where: { idempotencyKey } });
      if (duplicate) throw new Error("DUPLICATE_INVESTOR_ACTION");

      const participant = await tx.investmentParticipant.findUnique({ where: { id: participantId } });
      if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");

      if (actionType === "reversal") {
        const reversalOfActionId = Number(body.reversalOfActionId || 0);
        const reason = String(body.reversalReason || body.remarks || "").trim();
        if (!reversalOfActionId) throw new Error("REVERSAL_ACTION_REQUIRED");
        if (!reason) throw new Error("REVERSAL_REASON_REQUIRED");
        const original = await (tx as any).investmentParticipantAction.findFirst({
          where: { id: reversalOfActionId, participantId, status: "active" },
          include: { ledgerEntries: true, capitalEvent: true },
        });
        if (!original) throw new Error("REVERSAL_ORIGINAL_NOT_FOUND");

        let capitalEventId: number | null = null;
        if (original.capitalEvent) {
          const reversingAmount = -Number(original.capitalEvent.amountPkr);
          const eventType = reversingAmount < 0 ? "capital_withdrawal" : "capital_contribution";
          const reversalEvent = await tx.investmentCapitalEvent.create({
            data: {
              participantId,
              eventType: eventType as any,
              amountPkr: reversingAmount,
              effectiveDate,
              sourceType: "investor_action_reversal",
              sourceId: original.id,
              reason,
              createdBy: user.userId,
            },
          });
          capitalEventId = reversalEvent.id;
        }

        const beforeBalance = await loadParticipantBalance(participantId, tx);
        const reversal = await (tx as any).investmentParticipantAction.create({
          data: {
            participantId,
            actionType: "reversal",
            status: "active",
            profitAmountPkr: -Number(original.profitAmountPkr),
            capitalAmountPkr: -Number(original.capitalAmountPkr),
            totalAmountPkr: -Number(original.totalAmountPkr),
            ...settlementFieldsFor("reversal", 0),
            effectiveDate,
            oldCapitalPkr: beforeBalance.currentParticipatingCapitalPkr,
            newCapitalPkr: beforeBalance.currentParticipatingCapitalPkr + Number(original.capitalAmountPkr),
            oldAvailableProfitPkr: beforeBalance.currentAvailableProfitPkr,
            newAvailableProfitPkr: beforeBalance.currentAvailableProfitPkr + Number(original.profitAmountPkr),
            finalizedProfitSourcesJson: original.finalizedProfitSourcesJson,
            confirmationReference,
            idempotencyKey,
            remarks,
            reversalOfActionId: original.id,
            reversalReason: reason,
            capitalEventId,
            createdBy: user.userId,
          },
        });

        if (original.ledgerEntries?.length) {
          await (tx as any).investmentParticipantActionLedgerEntry.createMany({
            data: original.ledgerEntries.map((entry: any) => ({
              actionId: reversal.id,
              participantId,
              category: "reversal",
              amountPkr: -Number(entry.amountPkr),
              debitAccount: entry.creditAccount,
              creditAccount: entry.debitAccount,
              sourceFinalizationIds: entry.sourceFinalizationIds || [],
              reconciliationReference: `${idempotencyKey}:reverse:${entry.id}`,
              reversalOfEntryId: entry.id,
              createdBy: user.userId,
            })),
          });
        }
        await (tx as any).investmentParticipantAction.update({ where: { id: original.id }, data: { status: "reversed" } });
        return { action: reversal, balance: await loadParticipantBalance(participantId, tx) };
      }

      const balance = await loadParticipantBalance(participantId, tx);
      let profitAmountPkr = parseAmount(body.profitAmountPkr ?? body.amountPkr);
      let capitalAmountPkr = parseAmount(body.capitalAmountPkr);
      if (actionType === "capital_withdrawal") capitalAmountPkr = parseAmount(body.capitalAmountPkr ?? body.amountPkr);
      if (actionType === "full_exit") {
        profitAmountPkr = 0;
        capitalAmountPkr = 0;
        const unsettledAction = await (tx as any).investmentParticipantAction.findFirst({
          where: {
            participantId,
            status: "active",
            remainingSettlementPkr: { gt: 0 },
            settlementStatus: { in: ["unsettled", "partially_settled"] },
          },
          select: { id: true },
        });
        if (unsettledAction) throw new Error("FULL_EXIT_UNSETTLED_ACTIONS");
      }
      const validation = validateParticipantAction({ actionType, profitAmountPkr, capitalAmountPkr, balance, participantIsActive: participant.isActive });
      if (validation) throw new Error(`VALIDATION:${validation}`);

      if (["capital_withdrawal", "mixed_withdrawal", "profit_reinvestment", "full_exit"].includes(actionType)) {
        const finalized = await hasFinalizedAttributionOnOrAfter(tx, effectiveDate);
        if (finalized) throw new Error("CAPITAL_EVENT_LOCKED_BY_FINALIZATION");
      }

      const { consumed, remainingPkr } = consumeProfitSources(balance.finalizedProfitSources, profitAmountPkr);
      if (profitAmountPkr > 0 && remainingPkr > 0) throw new Error("PROFIT_SOURCE_ALLOCATION_FAILED");

      const oldCapital = balance.currentParticipatingCapitalPkr;
      const newCapital = round2(actionType === "profit_reinvestment" ? oldCapital + profitAmountPkr : oldCapital - capitalAmountPkr);
      const oldProfit = balance.currentAvailableProfitPkr;
      const newProfit = round2(oldProfit - profitAmountPkr);
      const totalAmountPkr = round2(profitAmountPkr + capitalAmountPkr);
      const settlementFields = settlementFieldsFor(actionType, totalAmountPkr);

      const action = await (tx as any).investmentParticipantAction.create({
        data: {
          participantId,
          actionType,
          status: "active",
          profitAmountPkr,
          capitalAmountPkr,
          totalAmountPkr,
          ...settlementFields,
          effectiveDate,
          oldCapitalPkr: oldCapital,
          newCapitalPkr: newCapital,
          oldAvailableProfitPkr: oldProfit,
          newAvailableProfitPkr: newProfit,
          finalizedProfitSourcesJson: consumed,
          confirmationReference,
          idempotencyKey,
          remarks,
          createdBy: user.userId,
        },
      });

      const eventType = actionCapitalEventType(actionType, capitalAmountPkr);
      if (eventType) {
        const capitalEventAmount = actionType === "profit_reinvestment" ? profitAmountPkr : -capitalAmountPkr;
        const event = await tx.investmentCapitalEvent.create({
          data: {
            participantId,
            eventType: eventType as any,
            amountPkr: capitalEventAmount,
            effectiveDate,
            sourceType: "investor_action",
            sourceId: action.id,
            reason: remarks,
            createdBy: user.userId,
          },
        });
        await (tx as any).investmentParticipantAction.update({ where: { id: action.id }, data: { capitalEventId: event.id } });
      }

      const ledgerRows = ledgerRowsForAction({ actionId: action.id, participantId, actionType, profitAmountPkr, capitalAmountPkr, consumedSources: consumed, idempotencyKey, userId: user.userId });
      if (ledgerRows.length) await (tx as any).investmentParticipantActionLedgerEntry.createMany({ data: ledgerRows });

      if (actionType === "full_exit") {
        const finalBalance = await loadParticipantBalance(participantId, tx);
        if (finalBalance.currentParticipatingCapitalPkr !== 0 || finalBalance.currentAvailableProfitPkr !== 0) {
          throw new Error("FULL_EXIT_BALANCE_REMAINS");
        }
        await tx.investmentParticipant.update({ where: { id: participantId }, data: { isActive: false, exitedAt: effectiveDate } });
      }

      return { action: await (tx as any).investmentParticipantAction.findUnique({ where: { id: action.id }, include: { ledgerEntries: true, capitalEvent: true } }), balance: await loadParticipantBalance(participantId, tx) };
    });

    return successResponse(result, "Investor action recorded", 201);
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message === "DUPLICATE_INVESTOR_ACTION") return errorResponse("DUPLICATE", "Duplicate investor action reference", 409);
    if (message === "PARTICIPANT_NOT_FOUND") return errorResponse("NOT_FOUND", "Participant not found", 404);
    if (message === "REVERSAL_ACTION_REQUIRED") return errorResponse("VALIDATION", "Original action is required for reversal", 400);
    if (message === "REVERSAL_REASON_REQUIRED") return errorResponse("VALIDATION", "Reversal reason is required", 400);
    if (message === "REVERSAL_ORIGINAL_NOT_FOUND") return errorResponse("VALIDATION", "Original active action was not found", 400);
    if (message === "CAPITAL_EVENT_LOCKED_BY_FINALIZATION") return errorResponse("VALIDATION", "Capital change effective date is inside or before finalized attribution history", 400);
    if (message === "FULL_EXIT_UNSETTLED_ACTIONS") return errorResponse("VALIDATION", "Full exit requires no unresolved settlement action", 400);
    if (message === "FULL_EXIT_BALANCE_REMAINS") return errorResponse("VALIDATION", "Full exit requires zero current capital and zero available finalized profit", 400);
    if (message === "PROFIT_SOURCE_ALLOCATION_FAILED") return errorResponse("VALIDATION", "Finalized profit source allocation failed", 400);
    if (message.startsWith("VALIDATION:")) return errorResponse("VALIDATION", message.replace("VALIDATION:", ""), 400);
    console.error("Investment participant action create error:", error);
    return serverError();
  }
});
