import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalHajiTransfer } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

const PAKISTAN_HAJI_TARGET = "Super Admin Account";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const h = await prisma.hajiTransfer.findUnique({ where: { id }, include: { currency: true } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    const city = await prisma.city.findUnique({ where: { id: h.cityId }, include: { country: true } });
    if (city?.country?.name === "Afghanistan" && body.sourceType && body.sourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city Haji transfers can only use office cash");
    }
    const forcedTransferredTo = city?.country?.name === "Pakistan" ? PAKISTAN_HAJI_TARGET : (body.transferredTo !== undefined ? body.transferredTo : h.transferredTo);

    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({
        where: {
          transactionId: {
            in: [`HAJI-${id}`, `REV-HAJI-${id}`],
          },
        },
      });

      const updated = await tx.hajiTransfer.update({
        where: { id },
        data: {
          amount: body.amount || h.amount,
          detail: body.detail || h.detail,
          transferredTo: forcedTransferredTo,
          notes: body.notes !== undefined ? body.notes : h.notes,
          updatedAt: new Date(),
        },
      });

      await journalHajiTransfer({
        id,
        cityId: h.cityId,
        amount: Number(updated.amount),
        currencyCode: h.currency.code,
        date: h.transferDate,
        createdBy: user.userId,
        sourceType: (h as any).sourceType ?? null,
        bankAccountId: (h as any).bankAccountId ?? null,
      }, tx);

      await createAuditLog(
        user.userId,
        h.cityId,
        "haji_transfers",
        id,
        "update",
        { amount: Number(h.amount) },
        { amount: Number(updated.amount) },
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
    const h = await prisma.hajiTransfer.findUnique({ where: { id } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`HAJI-${id}`, user.userId, tx);

      // If this transfer was sourced from a cheque, restore chequeStatus → "in_hand"
      // so the cheque can be deposited or used again.
      const chequePaymentId = (h as any).chequePaymentId;
      if (chequePaymentId) {
        await tx.payment.update({ where: { id: chequePaymentId }, data: { chequeStatus: "in_hand" } as any });
      }

      await tx.hajiTransfer.delete({ where: { id } });
      await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "delete", undefined, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
