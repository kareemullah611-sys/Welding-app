import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { assertProfitShareTotal, hasFinalizedAttributionOnOrAfter } from "@/lib/investment-participation";

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const body = await request.json();
    const effectiveDate = parseDate(body.effectiveDate);
    if (!participantId) return errorResponse("VALIDATION", "Participant is required", 400);
    if (!effectiveDate) return errorResponse("VALIDATION", "Effective date is required", 400);

    const participant = await prisma.investmentParticipant.findUnique({ where: { id: participantId } });
    if (!participant) return errorResponse("NOT_FOUND", "Participant not found", 404);

    const finalized = await hasFinalizedAttributionOnOrAfter(effectiveDate);
    if (finalized) return errorResponse("VALIDATION", "Cannot change profit share inside or before a finalized attribution period", 400);

    const share = assertProfitShareTotal(
      participant.type === "manager" ? 100 : body.investorProfitSharePercent,
      participant.type === "manager" ? 0 : body.managerProfitSharePercent
    );
    if (!share.ok) return errorResponse("VALIDATION", share.message, 400);

    const event = await prisma.investmentProfitShareEvent.create({
      data: {
        participantId,
        effectiveDate,
        investorProfitSharePercent: share.investorShare,
        managerProfitSharePercent: share.managerShare,
        reference: String(body.reference || "").trim() || null,
        remarks: String(body.remarks || "").trim() || null,
        createdBy: user.userId,
      },
    });

    return successResponse(event, "Profit share change recorded", 201);
  } catch (error) {
    console.error("Investment profit share event create error:", error);
    return serverError();
  }
});
