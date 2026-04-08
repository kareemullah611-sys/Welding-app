import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can update these expenses", 403);
    }

    const id = Number(context.params.id);
    const body = await request.json();
    const expense = await prisma.superAdminPersonalExpense.findUnique({
      where: { id },
      include: { bankAccount: { include: { currency: true } } },
    });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);

    const amount = body.amount !== undefined ? Number(body.amount) : Number(expense.amount);
    const detail = body.detail !== undefined ? String(body.detail || "").trim() : expense.detail;
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes) : null) : expense.notes;

    if (!amount || Number.isNaN(amount) || amount <= 0) return errorResponse("VALIDATION_ERROR", "Amount must be greater than zero");
    if (!detail) return errorResponse("VALIDATION_ERROR", "Detail is required");

    const updated = await prisma.superAdminPersonalExpense.update({
      where: { id },
      data: { amount, detail, notes },
      include: { bankAccount: { include: { currency: true } } },
    });

    await createAuditLog(
      user.userId,
      null,
      "super_admin_personal_expenses",
      id,
      "update",
      { amount: Number(expense.amount), detail: expense.detail, notes: expense.notes },
      { amount: Number(updated.amount), detail: updated.detail, notes: updated.notes },
      getClientIP(request)
    );

    return successResponse({ id }, "Personal expense updated");
  } catch {
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can delete these expenses", 403);
    }

    const id = Number(context.params.id);
    const expense = await prisma.superAdminPersonalExpense.findUnique({ where: { id } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);

    await prisma.superAdminPersonalExpense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await createAuditLog(
      user.userId,
      null,
      "super_admin_personal_expenses",
      id,
      "delete",
      { amount: Number(expense.amount), detail: expense.detail, notes: expense.notes },
      undefined,
      getClientIP(request)
    );

    return successResponse({ id }, "Personal expense deleted");
  } catch {
    return serverError();
  }
});
