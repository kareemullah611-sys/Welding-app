import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  assertProfitShareTotal,
  currentParticipantCapitalPkr,
  hasFinalizedAttributionOnOrAfter,
} from "@/lib/investment-participation";

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const body = await request.json();
    const eventType = String(body.eventType || "");
    const effectiveDate = parseDate(body.effectiveDate);
    const amount = Number(body.amountPkr);

    if (!participantId) return errorResponse("VALIDATION", "Participant is required", 400);
    if (!["opening", "capital_contribution", "capital_withdrawal", "profit_reinvestment", "full_exit"].includes(eventType)) {
      return errorResponse("VALIDATION", "Invalid capital event type", 400);
    }
    if (!effectiveDate) return errorResponse("VALIDATION", "Effective date is required", 400);
    if (!Number.isFinite(amount) || amount <= 0) return errorResponse("VALIDATION", "PKR amount must be greater than 0", 400);

    const participant = await prisma.investmentParticipant.findUnique({
      where: { id: participantId },
      include: { profitShareEvents: { where: { effectiveDate: { lte: effectiveDate } }, orderBy: { effectiveDate: "desc" }, take: 1 } },
    });
    if (!participant) return errorResponse("NOT_FOUND", "Participant not found", 404);

    const finalized = await hasFinalizedAttributionOnOrAfter(effectiveDate);
    if (finalized) return errorResponse("VALIDATION", "Cannot add a capital event inside or before a finalized attribution period", 400);

    const latestShare = participant.profitShareEvents[0];
    const investorShare = body.investorProfitSharePercent ?? latestShare?.investorProfitSharePercent ?? (participant.type === "manager" ? 100 : null);
    const managerShare = body.managerProfitSharePercent ?? latestShare?.managerProfitSharePercent ?? (participant.type === "manager" ? 0 : null);
    const share = assertProfitShareTotal(investorShare, managerShare);
    if (!share.ok) return errorResponse("VALIDATION", share.message, 400);

    const signedAmount = ["capital_withdrawal", "full_exit"].includes(eventType) ? -Math.abs(amount) : Math.abs(amount);
    const currentCapital = await currentParticipantCapitalPkr(participantId, effectiveDate);
    if (["capital_withdrawal", "full_exit"].includes(eventType) && Math.abs(signedAmount) > currentCapital) {
      return errorResponse("VALIDATION", `Capital event amount exceeds available participating capital (${currentCapital})`, 400);
    }

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.investmentCapitalEvent.create({
        data: {
          participantId,
          eventType: eventType as any,
          amountPkr: signedAmount,
          effectiveDate,
          investorProfitSharePercent: share.investorShare,
          managerProfitSharePercent: share.managerShare,
          sourceType: String(body.reference || "").trim() || null,
          reason: String(body.remarks || "").trim() || null,
          createdBy: user.userId,
        },
      });
      if (eventType === "full_exit") {
        await tx.investmentParticipant.update({
          where: { id: participantId },
          data: { isActive: false, exitedAt: effectiveDate },
        });
      }
      return created;
    });

    return successResponse(event, "Capital event recorded", 201);
  } catch (error) {
    console.error("Investment capital event create error:", error);
    return serverError();
  }
});
