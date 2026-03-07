import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { journalHajiTransfer } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

// POST /api/v1/personal-withdrawals/[id]/approve
// Super admin approves a withdrawal → auto-creates a HajiTransfer
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can approve withdrawals", 403);
    }

    const id = parseInt(context.params.id);
    const withdrawal = await prisma.personalWithdrawal.findUnique({
      where: { id },
      include: { currency: true },
    });

    if (!withdrawal) return errorResponse("NOT_FOUND", "Withdrawal not found", 404);
    if (withdrawal.approvedAt) return errorResponse("CONFLICT", "Already approved", 409);

    // Find the FIFO ongoing lot for this city
    const city = await prisma.city.findUnique({ where: { id: withdrawal.cityId }, select: { countryId: true } });
    if (!city) return errorResponse("NOT_FOUND", "City not found", 404);

    const lot = await prisma.lot.findFirst({
      where: {
        countryId: city.countryId,
        status: "ongoing",
        lotCityDistributions: { some: { cityId: withdrawal.cityId } },
      },
      orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "No ongoing lot found for this city");

    const detail = withdrawal.withdrawnBy
      ? `Withdrawal approved: ${withdrawal.withdrawnBy} — ${withdrawal.detail}`
      : `Withdrawal approved: ${withdrawal.detail}`;

    // Create HajiTransfer
    const hajiTransfer = await prisma.hajiTransfer.create({
      data: {
        cityId: withdrawal.cityId,
        lotId: lot.id,
        transferDate: new Date(),
        amount: withdrawal.amount,
        currencyId: withdrawal.currencyId,
        detail,
        transferType: "from_in_hand",
        notes: withdrawal.notes,
        createdBy: user.userId,
      },
    });

    // Mark withdrawal as approved and link to haji transfer
    await prisma.personalWithdrawal.update({
      where: { id },
      data: {
        approvedBy: user.userId,
        approvedAt: new Date(),
        hajiTransferId: hajiTransfer.id,
      },
    });

    await createAuditLog(user.userId, withdrawal.cityId, "personal_withdrawals", id, "update",
      { approvedBy: null }, { approvedBy: user.userId, hajiTransferId: hajiTransfer.id },
      getClientIP(request)
    );

    try {
      await journalHajiTransfer({
        id: hajiTransfer.id,
        cityId: hajiTransfer.cityId,
        lotId: hajiTransfer.lotId,
        amount: Number(hajiTransfer.amount),
        currencyCode: withdrawal.currency.code,
        transferDate: hajiTransfer.transferDate,
        createdBy: user.userId,
      });
    } catch (je) { console.error("Journal (haji from withdrawal approval):", je); }

    return successResponse({ hajiTransferId: hajiTransfer.id }, "Withdrawal approved and haji transfer created");
  } catch (error) {
    console.error("Approve withdrawal error:", error);
    return serverError();
  }
});
