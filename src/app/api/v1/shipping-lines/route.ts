import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, _context, _user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const [lines, total] = await Promise.all([
      prisma.shippingLine.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        skip, take: limit,
        include: { _count: { select: { payments: true, lotCosts: true } } },
      }),
      prisma.shippingLine.count({ where: { isActive: true } }),
    ]);

    // Compute running balance per shipping line
    const result = await Promise.all(lines.map(async (sl) => {
      const [costs, totalPaidUsd] = await Promise.all([
        prisma.lotCost.findMany({
          where: { shippingLineId: sl.id },
          select: { amount: true, currencyCode: true },
        }),
        prisma.shippingLinePayment.aggregate({
          where: { shippingLineId: sl.id },
          _sum: { amountUsd: true },
        }),
      ]);
      const billedByCurrency = costs.reduce<Record<string, number>>((acc, cost) => {
        const currencyCode = cost.currencyCode || "USD";
        acc[currencyCode] = Math.round(((acc[currencyCode] || 0) + Number(cost.amount)) * 100) / 100;
        return acc;
      }, {});
      const billed = billedByCurrency.USD || 0;
      const paid   = Number(totalPaidUsd._sum.amountUsd || 0);
      return {
        id: sl.id, name: sl.name, contact: sl.contact, notes: sl.notes,
        totalCosts: sl._count.lotCosts, totalPayments: sl._count.payments,
        billedByCurrency,
        hasNonUsdCharges: Object.keys(billedByCurrency).some((currencyCode) => currencyCode !== "USD"),
        billedUsd: billed, paidUsd: paid, balanceOwedUsd: billed - paid,
      };
    }));

    return paginatedResponse(result, total, page, limit);
  } catch (error) { console.error("List shipping lines:", error); return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (!body.name?.trim()) return validationError("Name is required");
    const sl = await prisma.shippingLine.create({
      data: { name: body.name.trim(), contact: body.contact || null, notes: body.notes || null },
    });
    await createAuditLog(user.userId, null, "shipping_lines", sl.id, "create", undefined, { name: sl.name }, getClientIP(request));
    return successResponse({ id: sl.id, name: sl.name }, "Shipping line created", 201);
  } catch (error) { console.error("Create shipping line:", error); return serverError(); }
});
