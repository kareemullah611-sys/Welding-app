import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { REVENUE_SALE_STATUSES } from "@/lib/sale-status";

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

    // Fix C3: collect all overflow writes + lot status update into a single transaction.
    type PendingOverflow = {
      kind: "resolvable" | "unresolvable";
      cityId: number;
      currencyId: number;
      overflowAmount: number;
      toLotId?: number;
      toLotNumber?: string;
    };
    const pendingOverflows: PendingOverflow[] = [];

    for (const cityId of cityIds) {
      const salesByCurrency = await prisma.sale.groupBy({
        by: ["currencyId"],
        // Fix C5: include marked_short sales in revenue so settlement math agrees.
        where: { cityId, lotId, status: { in: REVENUE_SALE_STATUSES } },
        _sum: { totalAmount: true },
      });

      for (const saleCur of salesByCurrency) {
        const currencyId = saleCur.currencyId;
        const revenue = Number(saleCur._sum.totalAmount || 0);

        const expenseSum = await prisma.expense.aggregate({ where: { cityId, lotId, currencyId, deletedAt: null }, _sum: { amount: true } });
        const overflowCreditsSum = await prisma.lotSettlementOverflow.aggregate({
          where: { cityId, toLotId: lotId, currencyId },
          _sum: { overflowAmount: true },
        });
        const hajiSum = await prisma.hajiTransfer.aggregate({ where: { cityId, lotId, currencyId }, _sum: { amount: true } });
        const discountSum = await prisma.saleDiscount.aggregate({ where: { appliedToLotId: lotId, currencyId, sale: { cityId } }, _sum: { discountAmount: true } });

        const expenses = Number(expenseSum._sum.amount || 0);
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
            pendingOverflows.push({ kind: "resolvable", cityId, currencyId, overflowAmount, toLotId: nextLot.id, toLotNumber: nextLot.lotNumber });
            overflows.push({ cityId, currencyId, overflowAmount: Math.round(overflowAmount * 100) / 100, toLotId: nextLot.id, toLotNumber: nextLot.lotNumber });
          } else {
            pendingOverflows.push({ kind: "unresolvable", cityId, currencyId, overflowAmount });
            unresolvableOverflows.push({ cityId, currencyId, overflowAmount: Math.round(overflowAmount * 100) / 100, warning: "No ongoing lot found for this city — overflow was NOT applied. Manually adjust once a new lot is created." });
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const p of pendingOverflows) {
        if (p.kind === "resolvable" && p.toLotId != null) {
          await tx.lotSettlementOverflow.create({
            data: { cityId: p.cityId, fromLotId: lotId, toLotId: p.toLotId, overflowAmount: p.overflowAmount, currencyId: p.currencyId, notes: `Auto-overflow from lot ${lot.lotNumber} completion`, createdBy: user.userId },
          });
        } else {
          await tx.lotSettlementUnresolvedOverflow.create({
            data: { cityId: p.cityId, fromLotId: lotId, overflowAmount: p.overflowAmount, currencyId: p.currencyId, notes: `Unresolved overflow from lot ${lot.lotNumber} completion — no ongoing lot available`, createdBy: user.userId },
          });
        }
      }
      await tx.lot.update({ where: { id: lotId }, data: { status: "completed", completedBy: user.userId, completedAt: new Date(), updatedAt: new Date() } });
      await createAuditLog(user.userId, null, "lots", lotId, "update", { status: "ongoing" }, { status: "completed", overflows, unresolvableOverflows }, getClientIP(request), tx);
    });

    return successResponse({
      lotId, lotNumber: lot.lotNumber, status: "completed",
      overflows: overflows.length > 0 ? overflows : [],
      unresolvableOverflows: unresolvableOverflows.length > 0 ? unresolvableOverflows : [],
      message: unresolvableOverflows.length > 0
        ? `Lot completed with ${unresolvableOverflows.length} unresolved overflow(s) — manual adjustment required (recorded in lot_settlement_unresolved_overflows table)`
        : "Lot completed successfully",
    }, "Lot completed successfully");
  } catch (error) {
    console.error("Lot completion error:", error);
    return serverError();
  }
});
