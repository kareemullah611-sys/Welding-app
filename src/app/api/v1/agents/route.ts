import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const agents = await prisma.agent.findMany({
      where: { isActive: true }, orderBy: { name: "asc" }, skip, take: limit,
      include: { city: { select: { id: true, name: true } }, lotCosts: { where: { paidFromCash: false } }, agentPayments: true },
    });
    const total = await prisma.agent.count({ where: { isActive: true } });
    return paginatedResponse(agents.map(a => {
      const billed: Record<string, number> = {};
      const paid: Record<string, number> = {};
      for (const c of a.lotCosts) { billed[c.currencyCode] = (billed[c.currencyCode] || 0) + Number(c.amount); }
      for (const p of a.agentPayments) { paid[p.currencyCode] = (paid[p.currencyCode] || 0) + Number(p.amount); }
      const balance: Record<string, number> = {};
      for (const cc of Array.from(new Set([...Object.keys(billed), ...Object.keys(paid)]))) {
        balance[cc] = Math.round(((billed[cc] || 0) - (paid[cc] || 0)) * 100) / 100;
      }
      return { id: a.id, name: a.name, agentType: a.agentType, city: a.city, phone: a.phone, totalBilled: billed, totalPaid: paid, balance };
    }), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (!body.name) return validationError("Name required");
    const agent = await prisma.agent.create({ data: { name: body.name, agentType: body.agentType || "customs", cityId: body.cityId || null, phone: body.phone, notes: body.notes } });
    return successResponse({ id: agent.id }, "Agent created", 201);
  } catch (error) { return serverError(); }
});
