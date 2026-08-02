import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalExpenseCreated } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { updateExpenseSchema } from "@/lib/validations";
import { getSaCheckAuditStateMap, isSaCheckConfirmed } from "@/lib/sa-check-audit";

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
      paidFrom: (expense as any).paidFrom ?? "cash_office",
      bankAccountId: (expense as any).bankAccountId ?? null,
      chequePaymentId: (expense as any).chequePaymentId ?? null,
      lotNumber: expense.lot.lotNumber, currency: expense.currency.code,
    });
  } catch (error) { return serverError(); }
});

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (body?.action !== "set_sa_check") return errorResponse("VALIDATION_ERROR", "Invalid expense action", 400);

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can verify expenses", 403);

    const confirmed = !!body.confirmed;
    const stateById = await getSaCheckAuditStateMap("expenses", [expense.id]);
    const current = stateById[expense.id] || null;
    if ((current?.confirmed || false) === confirmed) {
      return successResponse({
        confirmed,
        confirmedAt: current?.confirmedAt || null,
        confirmedBy: current?.confirmedBy || null,
      }, confirmed ? "Expense was already verified" : "Expense was already unverified");
    }

    await createAuditLog(
      user.userId,
      expense.cityId,
      "expenses",
      expense.id,
      "update",
      {
        saCheckConfirmed: current?.confirmed || false,
        saCheckConfirmedAt: current?.confirmedAt || null,
        saCheckConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
      },
      {
        saCheckConfirmed: confirmed,
        saCheckNote: confirmed ? "Super admin verified expense" : "Super admin removed expense verification",
      },
      getClientIP(request)
    );

    return successResponse({
      confirmed,
      confirmedAt: new Date().toISOString(),
      confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
    }, confirmed ? "Expense verified" : "Expense verification removed");
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid expense update", 400, parsed.error.errors);
    const data = parsed.data;
    const expense = await prisma.expense.findUnique({ where: { id }, include: { currency: true } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if (await isSaCheckConfirmed("expenses", expense.id)) {
      return errorResponse("FORBIDDEN", "Cannot edit an expense after super admin verification", 403);
    }

    const nextPaidFrom = data.paidFrom ?? ((expense as any).paidFrom ?? "cash_office");
    const nextBankAccountId = nextPaidFrom === "bank_account"
      ? (data.bankAccountId ?? ((expense as any).bankAccountId ?? null))
      : null;
    const nextChequePaymentId = nextPaidFrom === "cheque"
      ? (data.chequePaymentId ?? ((expense as any).chequePaymentId ?? null))
      : null;
    const nextExpenseDate = data.expenseDate ? new Date(data.expenseDate) : expense.expenseDate;
    if (Number.isNaN(nextExpenseDate.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid expense date");

    if ((expense as any).paidFrom === "cheque") {
      const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(expense.amount);
      const sourceChanged = nextPaidFrom !== "cheque" || nextChequePaymentId !== ((expense as any).chequePaymentId ?? null);
      if (amountChanged || sourceChanged) {
        return errorResponse("VALIDATION_ERROR", "Cannot change amount or source for an expense that was paid from a cheque");
      }
    }
    if (nextPaidFrom === "bank_account" && !nextBankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account is required when source is bank account");
    }
    if (nextPaidFrom === "cheque" && !nextChequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque is required when source is cheque");
    }
    if (nextPaidFrom === "bank_account" && nextBankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!bankAccount || !bankAccount.isActive) return errorResponse("NOT_FOUND", "Selected bank account not found", 404);
      if (bankAccount.cityId !== expense.cityId) return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
    }
    const nextLotId = data.lotId !== undefined && data.lotId ? data.lotId : expense.lotId;
    if (!nextLotId) return errorResponse("VALIDATION_ERROR", "Lot is required");
    const lotChanged = nextLotId !== expense.lotId;
    const nextLot = lotChanged
      ? await prisma.lot.findFirst({
          where: {
            id: nextLotId,
            status: "ongoing",
            lotCityDistributions: { some: { cityId: expense.cityId } },
          },
          select: { id: true, lotNumber: true },
        })
      : await prisma.lot.findUnique({ where: { id: nextLotId }, select: { id: true, lotNumber: true } });
    if (!nextLot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");

    const old = {
      date: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount),
      detail: expense.detail,
      lotId: expense.lotId,
      paidFrom: (expense as any).paidFrom ?? "cash_office",
      bankAccountId: (expense as any).bankAccountId ?? null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({
        where: {
          transactionId: {
            in: [`EXP-${id}`, `REV-EXP-${id}`],
          },
        },
      });

      const next = await tx.expense.update({
        where: { id },
        data: {
          lotId: nextLot.id,
          expenseDate: nextExpenseDate,
          amount: data.amount || expense.amount,
          detail: data.detail || expense.detail,
          paidFrom: nextPaidFrom,
          bankAccountId: nextBankAccountId,
          chequePaymentId: nextChequePaymentId,
          notes: data.notes !== undefined ? data.notes : expense.notes,
          updatedAt: new Date(),
        } as any,
      });

      await journalExpenseCreated({
        id,
        cityId: expense.cityId,
        lotId: nextLot.id,
        amount: Number(next.amount),
        currencyCode: expense.currency.code,
        detail: next.detail,
        expenseDate: next.expenseDate,
        createdBy: user.userId,
        paidFrom: nextPaidFrom,
        bankAccountId: nextBankAccountId,
      }, tx);

      await createAuditLog(
        user.userId,
        expense.cityId,
        "expenses",
        id,
        "update",
        old,
        {
          date: next.expenseDate.toISOString().split("T")[0],
          amount: Number(next.amount),
          detail: next.detail,
          lotId: nextLot.id,
          paidFrom: nextPaidFrom,
          bankAccountId: nextBankAccountId,
        },
        getClientIP(request),
        tx
      );

    });

    return successResponse({ id }, "Expense updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`EXP-${id}`, user.userId, tx);

      if ((expense as any).chequePaymentId) {
        await tx.payment.update({
          where: { id: (expense as any).chequePaymentId },
          data: { chequeStatus: "in_hand" } as any,
        });
      }

      await tx.expense.update({ where: { id }, data: { deletedAt: new Date() } });

      await createAuditLog(
        user.userId,
        expense.cityId,
        "expenses",
        id,
        "delete",
        { amount: Number(expense.amount), detail: expense.detail },
        undefined,
        getClientIP(request),
        tx
      );
    });

    return successResponse({ id }, "Expense deleted");
  } catch (error) { return serverError(); }
});
