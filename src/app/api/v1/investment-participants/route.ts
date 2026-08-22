import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { assertProfitShareTotal, hasFinalizedAttributionOnOrAfter } from "@/lib/investment-participation";
import { loadParticipantBalance } from "@/lib/investor-participant-actions";

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const participants = await (prisma as any).investmentParticipant.findMany({
      include: {
        investor: { select: { id: true, name: true } },
        capitalEvents: { orderBy: { effectiveDate: "desc" } },
        profitShareEvents: { orderBy: { effectiveDate: "desc" } },
        participantActions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            settlements: {
              include: {
                currency: true,
                payments: { include: { currency: true, superAdminAccount: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            },
          },
        },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    const balances = await Promise.all(participants.map((participant: any) => loadParticipantBalance(participant.id)));
    const balanceByParticipantId = new Map(balances.map((balance) => [balance.participantId, balance]));

    const rows = participants.map((participant: any) => {
      const capital = participant.capitalEvents.reduce((sum: number, event: any) => sum + Number(event.amountPkr), 0);
      const latestShare = participant.profitShareEvents[0] || null;
      const balance = balanceByParticipantId.get(participant.id) || null;
      return {
        id: participant.id,
        investorId: participant.investorId,
        investorName: participant.investor?.name || null,
        name: participant.name,
        type: participant.type,
        isActive: participant.isActive,
        exitedAt: participant.exitedAt?.toISOString().slice(0, 10) || null,
        notes: participant.notes,
        capitalPkr: capital,
        balance,
        latestInvestorProfitSharePercent: latestShare ? Number(latestShare.investorProfitSharePercent) : (participant.type === "manager" ? 100 : null),
        latestManagerProfitSharePercent: latestShare ? Number(latestShare.managerProfitSharePercent) : (participant.type === "manager" ? 0 : null),
        capitalEvents: participant.capitalEvents.map((event: any) => ({
          id: event.id,
          eventType: event.eventType,
          amountPkr: Number(event.amountPkr),
          effectiveDate: event.effectiveDate.toISOString().slice(0, 10),
          investorProfitSharePercent: event.investorProfitSharePercent == null ? null : Number(event.investorProfitSharePercent),
          managerProfitSharePercent: event.managerProfitSharePercent == null ? null : Number(event.managerProfitSharePercent),
          reference: event.sourceType,
          remarks: event.reason,
          createdAt: event.createdAt,
        })),
        profitShareEvents: participant.profitShareEvents.map((event: any) => ({
          id: event.id,
          effectiveDate: event.effectiveDate.toISOString().slice(0, 10),
          investorProfitSharePercent: Number(event.investorProfitSharePercent),
          managerProfitSharePercent: Number(event.managerProfitSharePercent),
          reference: event.reference,
          remarks: event.remarks,
          createdAt: event.createdAt,
        })),
        participantActions: participant.participantActions.map((action: any) => ({
          id: action.id,
          actionType: action.actionType,
          status: action.status,
          totalAmountPkr: Number(action.totalAmountPkr),
          settledAmountPkr: Number(action.settledAmountPkr || 0),
          remainingSettlementPkr: Number(action.remainingSettlementPkr || 0),
          settlementStatus: action.settlementStatus || "unsettled",
          effectiveDate: action.effectiveDate.toISOString().slice(0, 10),
          confirmationReference: action.confirmationReference,
          settlements: (action.settlements || []).map((settlement: any) => ({
            id: settlement.id,
            status: settlement.status,
            currencyCode: settlement.currency?.code,
            settlementAmount: Number(settlement.settlementAmount),
            pkrEquivalent: Number(settlement.pkrEquivalent),
            profitComponentPkr: Number(settlement.profitComponentPkr || 0),
            capitalComponentPkr: Number(settlement.capitalComponentPkr || 0),
            exchangeRate: settlement.exchangeRate == null ? null : Number(settlement.exchangeRate),
            paymentDate: settlement.paymentDate.toISOString().slice(0, 10),
            paymentReference: settlement.paymentReference,
            paymentMethod: settlement.paymentMethod,
            bankCashAccount: settlement.bankCashAccount,
            paidPkr: (settlement.payments || [])
              .filter((payment: any) => payment.status !== "reversed")
              .reduce((sum: number, payment: any) => sum + Number(payment.pkrEquivalent || 0), 0),
            remainingUnpaidPkr: Number(settlement.pkrEquivalent || 0) - (settlement.payments || [])
              .filter((payment: any) => payment.status !== "reversed")
              .reduce((sum: number, payment: any) => sum + Number(payment.pkrEquivalent || 0), 0),
            payments: (settlement.payments || []).map((payment: any) => ({
              id: payment.id,
              status: payment.status,
              currencyCode: payment.currency?.code,
              paymentAmount: Number(payment.paymentAmount),
              pkrEquivalent: Number(payment.pkrEquivalent),
              paymentDate: payment.paymentDate.toISOString().slice(0, 10),
              paymentReference: payment.paymentReference,
              paymentMethod: payment.paymentMethod,
              accountName: payment.superAdminAccount?.bankName || null,
              journalTransactionId: payment.journalTransactionId,
            })),
          })),
        })),
      };
    });

    return successResponse(rows);
  } catch (error) {
    console.error("Investment participants list error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const type = String(body.type || "investor").toLowerCase();
    const effectiveDate = parseDate(body.effectiveDate);
    const initialCapital = Number(body.initialCapitalPkr || 0);

    if (!name) return errorResponse("VALIDATION", "Participant name is required", 400);
    if (!["manager", "investor"].includes(type)) return errorResponse("VALIDATION", "Participant type must be manager or investor", 400);
    if (!effectiveDate) return errorResponse("VALIDATION", "Effective date is required", 400);
    if (initialCapital < 0) return errorResponse("VALIDATION", "Initial capital cannot be negative", 400);

    const finalized = await hasFinalizedAttributionOnOrAfter(effectiveDate);
    if (finalized) return errorResponse("VALIDATION", "Cannot create participant inside or before a finalized attribution period", 400);

    const investorShare = type === "manager" ? 100 : body.investorProfitSharePercent;
    const managerShare = type === "manager" ? 0 : body.managerProfitSharePercent;
    const share = assertProfitShareTotal(investorShare, managerShare);
    if (!share.ok) return errorResponse("VALIDATION", share.message, 400);

    const participant = await prisma.$transaction(async (tx) => {
      const created = await tx.investmentParticipant.create({
        data: {
          name,
          type: type as "manager" | "investor",
          notes: String(body.notes || "").trim() || null,
          createdBy: user.userId,
        },
      });
      await tx.investmentProfitShareEvent.create({
        data: {
          participantId: created.id,
          effectiveDate,
          investorProfitSharePercent: share.investorShare,
          managerProfitSharePercent: share.managerShare,
          reference: String(body.reference || "").trim() || "opening_share",
          remarks: String(body.remarks || "").trim() || null,
          createdBy: user.userId,
        },
      });
      if (initialCapital > 0) {
        await tx.investmentCapitalEvent.create({
          data: {
            participantId: created.id,
            eventType: "opening",
            amountPkr: initialCapital,
            effectiveDate,
            investorProfitSharePercent: share.investorShare,
            managerProfitSharePercent: share.managerShare,
            sourceType: String(body.reference || "").trim() || "opening",
            reason: String(body.remarks || "").trim() || null,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse(participant, "Investment participant created", 201);
  } catch (error) {
    console.error("Investment participant create error:", error);
    return serverError();
  }
});
