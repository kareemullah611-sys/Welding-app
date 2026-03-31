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
    const unresolvableOverflows: any[] = [];

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

        // Fix P1: exclude soft-deleted expenses — missing deletedAt: null caused deleted
        // expenses to still reduce netOwed and produce false overflow amounts.
        const expenseSum = await prisma.expense.aggregate({ where: { cityId, lotId, currencyId, deletedAt: null }, _sum: { amount: true } });

        // Fix P1: exclude overflow-credit hajiTransfers (those created by a previous lot's
        // completion and credited TO this lot). Without this, overflow credits are counted
        // as "hajiTransferred" causing cascading false overflow on each subsequent lot.
        // We identify them via the lotSettlementOverflow table which tracks each overflow.
        const overflowCreditsSum = await prisma.lotSettlementOverflow.aggregate({
          where: { cityId, toLotId: lotId, currencyId },
          _sum: { overflowAmount: true },
        });
        const hajiSum = await prisma.hajiTransfer.aggregate({ where: { cityId, lotId, currencyId }, _sum: { amount: true } });
        const discountSum = await prisma.saleDiscount.aggregate({ where: { appliedToLotId: lotId, currencyId, sale: { cityId } }, _sum: { discountAmount: true } });

        const expenses = Number(expenseSum._sum.amount || 0);
        // Subtract overflow credits so they don't inflate hajiTransferred
        const hajiTransferred = Number(hajiSum._sum.amount || 0) - Number(overflowCreditsSum._sum.overflowAmount || 0);
        const discounts = Number(discountSum._sum.discountAmount || 0);
        const netOwed = revenue - expenses - discounts;
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
          } else {
            // No ongoing lot to absorb the overflow — record it in the response so the super admin is aware
            unresolvableOverflows.push({ cityId, currencyId, overflowAmount: Math.round(overflowAmount * 100) / 100, warning: "No ongoing lot found for this city — overflow was NOT applied. Manually adjust once a new lot is created." });
          }
        }
      }
    }

    // Mark lot as completed
    await prisma.lot.update({
      where: { id: lotId },
      data: { status: "completed", completedBy: user.userId, completedAt: new Date(), updatedAt: new Date() },
    });

    await createAuditLog(user.userId, null, "lots", lotId, "update", { status: "ongoing" }, { status: "completed", overflows, unresolvableOverflows }, getClientIP(request));

    return successResponse({
      lotId, lotNumber: lot.lotNumber, status: "completed",
      overflows: overflows.length > 0 ? overflows : [],
      unresolvableOverflows: unresolvableOverflows.length > 0 ? unresolvableOverflows : [],
      message: unresolvableOverflows.length > 0
        ? `Lot completed with ${unresolvableOverflows.length} unresolved overflow(s) — manual adjustment required`
        : "Lot completed successfully",
    }, "Lot completed successfully");
  } catch (error) {
    console.error("Lot completion error:", error);
    return serverError();
  }
});
