import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import type { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const id = Number(context.params.id);
    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    const reason = String(body.reason || "").trim();
    if (!Number.isInteger(id) || !["close", "reopen"].includes(action) || !reason) {
      return errorResponse("VALIDATION", "Valid action and reason are required", 400);
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `financial-year:${id}`);
      const current = await tx.financialYear.findUnique({ where: { id } });
      if (!current) throw new Error("NOT_FOUND");
      if (action === "close") {
        if (current.status === "closed") return current;
        const groups = await tx.journalEntry.groupBy({
          by: ["transactionId", "currencyCode"],
          where: { entryDate: { gte: current.startDate, lte: current.endDate } },
          _sum: { debit: true, credit: true },
        });
        const unbalanced = groups.find((group) => Math.abs(Number(group._sum.debit || 0) - Number(group._sum.credit || 0)) > 0.01);
        if (unbalanced) throw new Error(`UNBALANCED:${unbalanced.transactionId}:${unbalanced.currencyCode}`);
        const next = await tx.financialYear.update({ where: { id }, data: { status: "closed", closeReason: reason, closedBy: user.userId, closedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: user.userId, entityType: "financial_years", entityId: id, action: "update", oldValues: { status: current.status }, newValues: { status: "closed", reason, operation: "close" } } });
        return next;
      }
      if (current.status === "open") return current;
      const next = await tx.financialYear.update({ where: { id }, data: { status: "open", reopenReason: reason, reopenedBy: user.userId, reopenedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: user.userId, entityType: "financial_years", entityId: id, action: "update", oldValues: { status: current.status }, newValues: { status: "open", reason, operation: "reopen" } } });
      return next;
    });
    return successResponse(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") return errorResponse("NOT_FOUND", "Financial year not found", 404);
    if (message.startsWith("UNBALANCED:")) return errorResponse("ACCOUNTING_BLOCKED", `Cannot close year: unbalanced journal ${message.slice("UNBALANCED:".length)}`, 409);
    console.error("Update financial year error:", error);
    return serverError();
  }
});
