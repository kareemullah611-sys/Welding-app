import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalLotCost } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotCostSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const lotId = request.nextUrl.searchParams.get("lot_id") ? parseInt(request.nextUrl.searchParams.get("lot_id")!) : undefined;
    const where: any = {};
    if (lotId) where.lotId = lotId;

    const costs = await prisma.lotCost.findMany({
      where, include: { lot: { select: { id: true, lotNumber: true } } }, orderBy: { createdAt: "desc" },
    });

    return successResponse(costs.map((c) => ({
      id: c.id, lotId: c.lotId, lotNumber: c.lot.lotNumber,
      costType: c.costType, description: c.description,
      amount: Number(c.amount), currencyCode: c.currencyCode,
      exchangeRate: c.exchangeRate ? Number(c.exchangeRate) : null,
      costDate: c.costDate?.toISOString().split("T")[0] || null, notes: c.notes,
    })));
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (!body.lotId || !body.costType || !body.description || !body.amount) {
      return validationError("Lot, type, description, and amount required");
    }
    if (Number(body.amount) <= 0) return validationError("Amount must be greater than 0");

    const lot = await prisma.lot.findUnique({ where: { id: body.lotId } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const costType = String(body.costType || "");
    const agentId = body.agentId ? Number(body.agentId) : null;
    const shippingLineId = body.shippingLineId ? Number(body.shippingLineId) : null;

    if (costType === "freight") {
      if (!shippingLineId) return validationError("Shipping line is required for freight");
      if (agentId) return validationError("Freight must be charged to a shipping line, not an agent");
      const shippingLine = await prisma.shippingLine.findUnique({ where: { id: shippingLineId }, select: { id: true, isActive: true } });
      if (!shippingLine?.isActive) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    } else {
      if (shippingLineId) return validationError("Shipping line can only be used for freight costs");
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, isActive: true } });
        if (!agent?.isActive) return errorResponse("NOT_FOUND", "Agent not found", 404);
      }
    }

    const cost = await prisma.$transaction(async (tx) => {
      const createdCost = await tx.lotCost.create({
        data: {
          lotId: body.lotId, costType: body.costType as any,
          description: body.description, amount: body.amount,
          currencyCode: body.currencyCode || "USD",
          exchangeRate: body.exchangeRate || null,
          costDate: body.costDate ? new Date(body.costDate) : null,
          agentId,
          shippingLineId,
          paidFromCash: body.paidFromCash === true,
          notes: body.notes || null, createdBy: user.userId,
        },
      });

      await createAuditLog(user.userId, null, "lot_costs", createdCost.id, "create", undefined, body, getClientIP(request), tx);
      await journalLotCost({ id: createdCost.id, lotId: body.lotId, costType: body.costType, amount: body.amount, currencyCode: body.currencyCode || "USD", createdBy: user.userId, agentId: agentId || undefined, shippingLineId: shippingLineId || undefined }, tx);
      return createdCost;
    });

    return successResponse({ id: cost.id }, "Cost recorded", 201);
  } catch (error) { console.error("Create lot cost error:", error); return serverError(); }
});
