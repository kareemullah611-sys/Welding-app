import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const AGENT_SYNC_MODULE = "agents";
const SUPERADMIN_SYNC_CITY_ID = 0;

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
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    if (!body.name) return validationError("Name required");
    if (body.agentType === "freight") return validationError("Use Shipping Lines for freight parties");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: AGENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingAgent = await prisma.agent.findUnique({ where: { id: existingSync.entityId } });
        if (existingAgent) return successResponse({ id: existingAgent.id }, "Agent already synced");
      }
    }

    const agent = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({ data: { name: body.name, agentType: body.agentType || "customs", cityId: body.cityId || null, phone: body.phone, notes: body.notes } });
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: AGENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "agents",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({ id: agent.id }, "Agent created", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: AGENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingAgent = await prisma.agent.findUnique({ where: { id: existingSync.entityId } });
        if (existingAgent) return successResponse({ id: existingAgent.id }, "Agent already synced");
      }
    }
    return serverError();
  }
});
