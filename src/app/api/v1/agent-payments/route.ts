import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalAgentPaid } from "@/lib/accounting";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError, paginatedResponse, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const agentId = request.nextUrl.searchParams.get("agent_id") ? parseInt(request.nextUrl.searchParams.get("agent_id")!) : undefined;
    const where: any = {};
    if (agentId) where.agentId = agentId;
    const [payments, total] = await Promise.all([
      prisma.agentPayment.findMany({ where, include: { agent: { select: { name: true } }, city: { select: { name: true } } }, orderBy: { paymentDate: "desc" }, skip, take: limit }),
      prisma.agentPayment.count({ where }),
    ]);
    return paginatedResponse(payments.map(p => ({ id: p.id, agentName: p.agent.name, cityName: p.city.name, paymentDate: p.paymentDate.toISOString().split("T")[0], amount: Number(p.amount), currencyCode: p.currencyCode, paymentMethod: p.paymentMethod, reference: p.reference })), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (!body.agentId || !body.amount || !body.cityId) return validationError("Agent, city, and amount required");
    const payment = await prisma.agentPayment.create({
      data: { agentId: body.agentId, cityId: body.cityId, paymentDate: new Date(body.paymentDate || new Date()), amount: body.amount, currencyCode: body.currencyCode || "PKR", paymentMethod: body.paymentMethod || "cash", reference: body.reference, notes: body.notes, createdBy: user.userId },
    });
    try { await journalAgentPaid({ id: payment.id, agentId: body.agentId, cityId: body.cityId, amount: body.amount, currencyCode: body.currencyCode || "PKR", paymentDate: new Date(body.paymentDate || new Date()), createdBy: user.userId }); } catch (e) { console.error("Journal entry error:", e); }
    return successResponse({ id: payment.id }, "Payment recorded", 201);
  } catch (error) { return serverError(); }
});
