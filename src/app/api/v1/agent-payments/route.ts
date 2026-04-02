import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalAgentPaid } from "@/lib/accounting";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError, paginatedResponse, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";

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
    const amount = Number(body.amount);
    const cityId = Number(body.cityId);
    const agentId = Number(body.agentId);
    if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than 0");
    if (!Number.isInteger(cityId) || cityId <= 0 || !Number.isInteger(agentId) || agentId <= 0) {
      return validationError("Agent and city must be valid");
    }

    const [agent, city] = await Promise.all([
      prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, cityId: true, isActive: true } }),
      prisma.city.findUnique({ where: { id: cityId }, select: { id: true } }),
    ]);
    if (!agent || !agent.isActive) return errorResponse("NOT_FOUND", "Agent not found", 404);
    if (!city) return errorResponse("NOT_FOUND", "City not found", 404);
    if (agent.cityId && agent.cityId !== cityId) {
      return errorResponse("VALIDATION_ERROR", "Settlement city must match the agent's city");
    }

    const source = await validatePaymentSource({
      bankAccountId: body.bankAccountId,
      intermediaryId: body.intermediaryId,
      cityId,
    });
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

    const payment = await prisma.agentPayment.create({
      data: {
        agentId, cityId,
        paymentDate: new Date(body.paymentDate || new Date()),
        amount, currencyCode: body.currencyCode || "PKR",
        paymentMethod: body.paymentMethod || "cash",
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
        reference: body.reference, notes: body.notes, createdBy: user.userId,
      },
    });
    try {
      await journalAgentPaid({
        id: payment.id,
        agentId,
        cityId,
        amount,
        currencyCode: body.currencyCode || "PKR",
        paymentDate: new Date(body.paymentDate || new Date()),
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      });
    } catch (e) { console.error("Journal entry error:", e); }
    return successResponse({ id: payment.id }, "Payment recorded", 201);
  } catch (error) { return serverError(); }
});
