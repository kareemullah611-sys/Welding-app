import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalExpenseCreated } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { lot: { select: { lotNumber: true } }, currency: true },
    });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    return successResponse({
      id: expense.id, expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount), detail: expense.detail, notes: expense.notes,
      lotNumber: expense.lot.lotNumber, currency: expense.currency.code,
    });
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const expense = await prisma.expense.findUnique({ where: { id }, include: { currency: true } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const old = { amount: Number(expense.amount), detail: expense.detail };

    try { await reverseJournalEntries(`EXP-${id}`, user.userId); } catch (je) { console.error("Reverse journal (expense):", je); }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        amount: body.amount || expense.amount,
        detail: body.detail || expense.detail,
        notes: body.notes !== undefined ? body.notes : expense.notes,
        updatedAt: new Date(),
      },
    });

    try {
      await journalExpenseCreated({ id, cityId: expense.cityId, lotId: expense.lotId!, amount: Number(updated.amount), currencyCode: expense.currency.code, detail: updated.detail, expenseDate: expense.expenseDate, createdBy: user.userId });
    } catch (je) { console.error("Re-journal (expense):", je); }

    await createAuditLog(user.userId, expense.cityId, "expenses", id, "update", old, { amount: Number(updated.amount), detail: updated.detail }, getClientIP(request));
    return successResponse({ id }, "Expense updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    try { await reverseJournalEntries(`EXP-${id}`, user.userId); } catch (je) { console.error("Reverse journal (expense delete):", je); }

    await prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });

    await createAuditLog(user.userId, expense.cityId, "expenses", id, "delete",
      { amount: Number(expense.amount), detail: expense.detail }, undefined, getClientIP(request));
    return successResponse({ id }, "Expense deleted");
  } catch (error) { return serverError(); }
});
