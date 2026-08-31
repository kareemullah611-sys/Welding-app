import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import type { JWTPayload } from "@/lib/auth";

function parseDate(value: unknown): Date | null {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  const rows = await prisma.financialYear.findMany({ orderBy: { startDate: "desc" } });
  return successResponse(rows);
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const startDate = parseDate(body.startDate);
    const endDate = parseDate(body.endDate);
    if (!name || !startDate || !endDate || endDate < startDate) {
      return errorResponse("VALIDATION", "A valid name and date range are required", 400);
    }
    const overlap = await prisma.financialYear.findFirst({
      where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { id: true, name: true },
    });
    if (overlap) return errorResponse("VALIDATION", `Financial year overlaps ${overlap.name}`, 400);
    const created = await prisma.$transaction(async (tx) => {
      const financialYear = await tx.financialYear.create({ data: { name, startDate, endDate, createdBy: user.userId } });
      await tx.auditLog.create({ data: { userId: user.userId, entityType: "financial_years", entityId: financialYear.id, action: "create", newValues: { name, startDate, endDate, status: "open" } } });
      return financialYear;
    });
    return successResponse(created, "Financial year created", 201);
  } catch (error) {
    console.error("Create financial year error:", error);
    return serverError();
  }
});
