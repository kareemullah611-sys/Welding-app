import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/:id/complete
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = parseInt(context.params.id);
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: { lotCityDistributions: { select: { cityId: true } } },
    });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (lot.status === "completed") return errorResponse("VALIDATION_ERROR", "Lot already completed");

    const cityIds = Array.from(new Set(lot.lotCityDistributions.map((d) => d.cityId)));
    const overflows: any[] = [];

    // For each city, calculate settlement and overflow (no transaction - avoids Neon timeout)
    for (const cityId of cityIds) {
      const salesByCurrency = await prisma.sale.groupBy({
        by: ["currencyId"],
        where: { cityId, lotId, status: "active" },
        _sum: { totalAmount: true },
      });

      for (const saleCur of salesByCurrency) {
        const currencyId = saleCur.currencyId;
        const revenue = Number(saleCur._sum.totalAmount || 0);

        const expenseSum = await prisma.expense.aggregate({ where: { cityId, lotId, currencyId }, _sum: { amount: true } });
        const hajiSum = await prisma.hajiTransfer.aggregate({ where: { cityId, lotId, currencyId }, _sum: { amount: true } });

        const expenses = Number(expenseSum._sum.amount || 0);
        const hajiTransferred = Number(hajiSum._sum.amount || 0);
        const netOwed = revenue - expenses;
        const overflowAmount = hajiTransferred - netOwed;

        if (overflowAmount > 0) {
          const nextLot = await prisma.lot.findFirst({
            where: { countryId: lot.countryId, status: "ongoing", id: { not: lotId }, lotCityDistributions: { some: { cityId } } },
            orderBy: [{ lotDate: "asc" }, { id: "asc" }],
          });

          if (nextLot) {
            await prisma.lotSettlementOverflow.create({
              data: { cityId, fromLotId: lotId, toLotId: nextLot.id, overflowAmount, currencyId, notes: `Auto-overflow from lot ${lot.lotNumber} completion`, createdBy: user.userId },
            });
            await prisma.hajiTransfer.create({
              data: { cityId, lotId: nextLot.id, transferDate: new Date(), amount: overflowAmount, currencyId, detail: `Overflow credit from completed lot ${lot.lotNumber}`, transferType: "from_in_hand", createdBy: user.userId },
            });
            overflows.push({ cityId, currencyId, overflowAmount: Math.round(overflowAmount * 100) / 100, toLotId: nextLot.id, toLotNumber: nextLot.lotNumber });
          }
        }
      }
    }

    // Mark lot as completed
    await prisma.lot.update({
      where: { id: lotId },
      data: { status: "completed", completedBy: user.userId, completedAt: new Date(), updatedAt: new Date() },
    });

    await createAuditLog(user.userId, null, "lots", lotId, "update", { status: "ongoing" }, { status: "completed", overflows }, getClientIP(request));

    return successResponse({
      lotId, lotNumber: lot.lotNumber, status: "completed",
      overflows: overflows.length > 0 ? overflows : "No overflows — all settlements balanced",
    }, "Lot completed successfully");
  } catch (error) {
    console.error("Lot completion error:", error);
    return serverError();
  }
});
