import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalWithdrawal } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const w = await prisma.personalWithdrawal.findUnique({ where: { id }, include: { currency: true } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if ((w as any).sourceType === "cheque" && body.amount !== undefined && Number(body.amount) !== Number(w.amount)) {
      return errorResponse("VALIDATION_ERROR", "Cannot change the amount of a withdrawal that was funded by a cheque");
    }

    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({
        where: {
          transactionId: {
            in: [`WDRAW-${id}`, `REV-WDRAW-${id}`],
          },
        },
      });

      const updated = await tx.personalWithdrawal.update({
        where: { id },
        data: {
          amount: body.amount || w.amount,
          detail: body.detail || w.detail,
          withdrawnBy: body.withdrawnBy !== undefined ? body.withdrawnBy : w.withdrawnBy,
          notes: body.notes !== undefined ? body.notes : w.notes,
          updatedAt: new Date(),
        },
      });

      await journalWithdrawal({
        id,
        cityId: w.cityId,
        amount: Number(updated.amount),
        currencyCode: w.currency.code,
        date: w.withdrawalDate,
        createdBy: user.userId,
        sourceType: (w as any).sourceType ?? "cash_office",
      }, tx);

      await createAuditLog(
        user.userId,
        w.cityId,
        "personal_withdrawals",
        id,
        "update",
        { amount: Number(w.amount), withdrawnBy: w.withdrawnBy, detail: w.detail, notes: w.notes },
        { amount: Number(updated.amount), withdrawnBy: updated.withdrawnBy, detail: updated.detail, notes: updated.notes },
        getClientIP(request),
        tx
      );
    });

    return successResponse({ id }, "Updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const w = await prisma.personalWithdrawal.findUnique({ where: { id } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.$transaction(async (tx) => {
      // Reverse the WDRAW journal (cash was credited on create, must be reversed on delete)
      await reverseJournalEntries(`WDRAW-${id}`, user.userId, tx);

      if ((w as any).chequePaymentId) {
        await tx.payment.update({
          where: { id: (w as any).chequePaymentId },
          data: { chequeStatus: "in_hand" } as any,
        });
      }

      // If this withdrawal was approved and linked to a haji transfer, also reverse that
      // haji transfer's journal and delete the record so no orphan exists.
      const hajiTransferId = (w as any).hajiTransferId;
      if (hajiTransferId) {
        await reverseJournalEntries(`HAJI-${hajiTransferId}`, user.userId, tx);
        await tx.hajiTransfer.delete({ where: { id: hajiTransferId } });
      }

      await tx.personalWithdrawal.delete({ where: { id } });
      await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "delete", undefined, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
