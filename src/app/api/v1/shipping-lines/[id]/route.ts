import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/shipping-lines/[id] — full ledger
export const GET = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const sl = await prisma.shippingLine.findUnique({ where: { id } });
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);

    const [costs, payments, hajiPayments] = await Promise.all([
      prisma.lotCost.findMany({
        where: { shippingLineId: id },
        include: { lot: { select: { id: true, lotNumber: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.shippingLinePayment.findMany({
        where: { shippingLineId: id },
        include: { lot: { select: { id: true, lotNumber: true } } },
        orderBy: { paymentDate: "desc" },
      }),
      prisma.hajiTransfer.findMany({
        where: { destinationShippingLineId: id, settlementDestination: "party_account" },
        include: { lot: { select: { id: true, lotNumber: true } } },
        orderBy: { transferDate: "desc" },
      }),
    ]);

    const totalBilledUsd = costs
      .filter(c => c.currencyCode === "USD")
      .reduce((s, c) => s + Number(c.amount), 0);
    const billedByCurrency = costs.reduce<Record<string, number>>((acc, cost) => {
      const currencyCode = cost.currencyCode || "USD";
      acc[currencyCode] = Math.round(((acc[currencyCode] || 0) + Number(cost.amount)) * 100) / 100;
      return acc;
    }, {});
    const totalPaidUsd = payments.reduce((s, p) => s + Number(p.amountUsd), 0) + hajiPayments.reduce((s, p) => s + Number(p.amount), 0);
    const totalPaidPkr = payments.reduce((s, p) => s + Number(p.amountPkr || 0), 0);

    return successResponse({
      id: sl.id, name: sl.name, contact: sl.contact, notes: sl.notes,
      summary: {
        totalBilledUsd: Math.round(totalBilledUsd * 100) / 100,
        totalPaidUsd:   Math.round(totalPaidUsd * 100) / 100,
        balanceOwedUsd: Math.round((totalBilledUsd - totalPaidUsd) * 100) / 100,
        totalPaidPkr:   Math.round(totalPaidPkr * 100) / 100,
        billedByCurrency,
        hasNonUsdCharges: Object.keys(billedByCurrency).some((currencyCode) => currencyCode !== "USD"),
      },
      charges: costs.map(c => ({
        id: c.id, lotNumber: c.lot.lotNumber, lotId: c.lotId,
        description: c.description, costType: c.costType,
        amount: Number(c.amount), currencyCode: c.currencyCode,
        costDate: c.costDate?.toISOString().split("T")[0] || null,
      })),
      payments: [
        ...payments.map(p => ({
        id: p.id, lotNumber: p.lot?.lotNumber || null, lotId: p.lotId,
        paymentDate: p.paymentDate.toISOString().split("T")[0],
        amountUsd: Number(p.amountUsd),
        exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
        amountPkr: p.amountPkr ? Number(p.amountPkr) : null,
        reference: p.reference, notes: p.notes,
        })),
        ...hajiPayments.map(h => ({
          id: `haji-${h.id}`, lotNumber: h.lot?.lotNumber || null, lotId: h.lotId,
          paymentDate: h.transferDate.toISOString().split("T")[0],
          amountUsd: Number(h.amount),
          exchangeRate: null,
          amountPkr: null,
          reference: h.referenceNo, notes: h.notes || "Haji party deposit",
        })),
      ],
    });
  } catch (error) { console.error("Shipping line detail:", error); return serverError(); }
});

// PUT /api/v1/shipping-lines/[id] — edit
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const sl = await prisma.shippingLine.findUnique({ where: { id } });
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    const updated = await prisma.shippingLine.update({
      where: { id },
      data: { name: body.name?.trim() || sl.name, contact: body.contact ?? sl.contact, notes: body.notes ?? sl.notes },
    });
    await createAuditLog(user.userId, null, "shipping_lines", id, "update", { name: sl.name }, { name: updated.name }, getClientIP(request));
    return successResponse({ id: updated.id }, "Updated");
  } catch (error) { return serverError(); }
});
