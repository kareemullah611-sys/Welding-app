import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { updateWithdrawalSchema } from "@/lib/validations";
import { getSaCheckAuditStateMap, isSaCheckConfirmed } from "@/lib/sa-check-audit";
import { isAfghanistanCountry } from "@/lib/country-code";
import { recordHajiTransferAccounting, reverseHajiTransferAccounting } from "@/lib/haji-transfer-accounting";

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (body?.action !== "set_sa_check") return errorResponse("VALIDATION_ERROR", "Invalid withdrawal action", 400);

    const withdrawal = await prisma.personalWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can verify withdrawals", 403);

    const confirmed = !!body.confirmed;
    const stateById = await getSaCheckAuditStateMap("personal_withdrawals", [withdrawal.id]);
    const current = stateById[withdrawal.id] || null;
    if ((current?.confirmed || false) === confirmed) {
      return successResponse({
        confirmed,
        confirmedAt: current?.confirmedAt || null,
        confirmedBy: current?.confirmedBy || null,
      }, confirmed ? "Withdrawal was already verified" : "Withdrawal was already unverified");
    }

    await createAuditLog(
      user.userId,
      withdrawal.cityId,
      "personal_withdrawals",
      withdrawal.id,
      "update",
      {
        saCheckConfirmed: current?.confirmed || false,
        saCheckConfirmedAt: current?.confirmedAt || null,
        saCheckConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
      },
      {
        saCheckConfirmed: confirmed,
        saCheckNote: confirmed ? "Super admin verified withdrawal" : "Super admin removed withdrawal verification",
      },
      getClientIP(request)
    );

    return successResponse({
      confirmed,
      confirmedAt: new Date().toISOString(),
      confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
    }, confirmed ? "Withdrawal verified" : "Withdrawal verification removed");
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const parsed = updateWithdrawalSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid withdrawal update", 400, parsed.error.errors);
    const data = parsed.data;
    const w = await prisma.personalWithdrawal.findUnique({
      where: { id },
      include: {
        currency: true,
        city: { include: { country: true } },
        hajiTransfer: { include: { currency: true } },
      },
    });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if (await isSaCheckConfirmed("personal_withdrawals", w.id)) {
      return errorResponse("FORBIDDEN", "Cannot edit a withdrawal after super admin verification", 403);
    }
    // Fix C8: refuse to edit an approved withdrawal.
    if (w.approvedAt) {
      return errorResponse(
        "CONFLICT",
        "Cannot edit an approved withdrawal — cancel it and create a new one instead",
        409,
      );
    }

    const nextWithdrawalDate = data.withdrawalDate ? new Date(data.withdrawalDate) : w.withdrawalDate;
    if (Number.isNaN(nextWithdrawalDate.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid withdrawal date");
    const nextSourceType = data.sourceType ?? ((w as any).sourceType ?? "cash_office");
    const nextBankAccountId = nextSourceType === "bank_account"
      ? (data.bankAccountId ?? ((w as any).bankAccountId ?? null))
      : null;

    if ((w as any).sourceType === "cheque") {
      const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(w.amount);
      const sourceChanged = nextSourceType !== "cheque";
      if (amountChanged || sourceChanged) {
        return errorResponse("VALIDATION_ERROR", "Cannot change amount or source for a withdrawal that was funded by a cheque");
      }
    }
    if (isAfghanistanCountry(w.city.country) && nextSourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city withdrawals can only use office cash");
    }
    if (nextSourceType === "bank_account" && !nextBankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account is required when source is bank account");
    }
    if (nextSourceType === "bank_account" && nextBankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!bankAccount || !bankAccount.isActive) return errorResponse("NOT_FOUND", "Selected bank account not found", 404);
      if (bankAccount.cityId !== w.cityId) return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
    }

    await prisma.$transaction(async (tx) => {
      if (w.hajiTransfer) {
        await reverseHajiTransferAccounting(tx, w.hajiTransfer, user.userId, "edit");
      }

      const updated = await tx.personalWithdrawal.update({
        where: { id },
        data: {
          withdrawalDate: nextWithdrawalDate,
          amount: data.amount || w.amount,
          detail: data.detail || w.detail,
          withdrawnBy: data.withdrawnBy !== undefined ? data.withdrawnBy : w.withdrawnBy,
          sourceType: nextSourceType,
          bankAccountId: nextBankAccountId,
          notes: data.notes !== undefined ? data.notes : w.notes,
          updatedAt: new Date(),
        } as any,
      });

      const hajiTransfer = w.hajiTransfer
        ? await tx.hajiTransfer.update({
            where: { id: w.hajiTransfer.id },
            data: {
              transferDate: nextWithdrawalDate,
              amount: data.amount || w.amount,
              detail: `Withdrawal — ${data.withdrawnBy ?? w.withdrawnBy ?? data.detail ?? w.detail}`,
              transferType: nextSourceType === "bank_account" ? "direct" : "from_in_hand",
              sourceType: nextSourceType === "bank_account" ? "bank_transfer" : "cash_office",
              bankAccountId: nextBankAccountId,
              notes: data.notes !== undefined ? data.notes : w.notes,
            },
            include: { currency: true },
          })
        : await tx.hajiTransfer.create({
            data: {
              cityId: w.cityId,
              transferDate: nextWithdrawalDate,
              amount: data.amount || w.amount,
              currencyId: w.currencyId,
              detail: `Withdrawal — ${data.withdrawnBy ?? w.withdrawnBy ?? data.detail ?? w.detail}`,
              transferType: nextSourceType === "bank_account" ? "direct" : "from_in_hand",
              transferredTo: "Super Admin Account",
              sourceType: nextSourceType === "bank_account" ? "bank_transfer" : "cash_office",
              bankAccountId: nextBankAccountId,
              notes: data.notes !== undefined ? data.notes : w.notes,
              createdBy: user.userId,
            },
            include: { currency: true },
          });
      await recordHajiTransferAccounting(tx, hajiTransfer, user.userId);
      if (!w.hajiTransferId) {
        await tx.personalWithdrawal.update({ where: { id }, data: { hajiTransferId: hajiTransfer.id } });
      }

      await createAuditLog(
        user.userId,
        w.cityId,
        "personal_withdrawals",
        id,
        "update",
        {
          date: w.withdrawalDate.toISOString().split("T")[0],
          amount: Number(w.amount),
          withdrawnBy: w.withdrawnBy,
          detail: w.detail,
          sourceType: (w as any).sourceType ?? "cash_office",
          bankAccountId: (w as any).bankAccountId ?? null,
          notes: w.notes,
        },
        {
          date: updated.withdrawalDate.toISOString().split("T")[0],
          amount: Number(updated.amount),
          withdrawnBy: updated.withdrawnBy,
          detail: updated.detail,
          sourceType: nextSourceType,
          bankAccountId: nextBankAccountId,
          notes: updated.notes,
        },
        getClientIP(request),
        tx
      );
    });

    return successResponse({ id }, "Updated");
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Insufficient foreign-currency carrying layers")) {
      return errorResponse("FOREIGN_CARRYING_LAYER_REQUIRED", error.message, 409);
    }
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const w = await prisma.personalWithdrawal.findUnique({
      where: { id },
      include: { hajiTransfer: { include: { currency: true } } },
    });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    // Fix C8: refuse to hard-delete an approved withdrawal.
    if (w.approvedAt) {
      return errorResponse(
        "CONFLICT",
        "Cannot delete an approved withdrawal — it has committed journal entries and a linked Haji transfer. Use the cancel flow instead.",
        409,
      );
    }

    await prisma.$transaction(async (tx) => {
      if ((w as any).chequePaymentId) {
        await tx.payment.update({
          where: { id: (w as any).chequePaymentId },
          data: { chequeStatus: "in_hand" } as any,
        });
      }

      if (w.hajiTransfer) {
        await reverseHajiTransferAccounting(tx, w.hajiTransfer, user.userId, "delete");
        await tx.personalWithdrawal.update({ where: { id }, data: { hajiTransferId: null } });
        await tx.hajiTransfer.delete({ where: { id: w.hajiTransfer.id } });
        await createAuditLog(user.userId, w.cityId, "haji_transfers", w.hajiTransfer.id, "delete", {
          withdrawalId: w.id,
          amount: Number(w.hajiTransfer.amount),
        }, undefined, getClientIP(request), tx);
      }

      await tx.personalWithdrawal.delete({ where: { id } });
      await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "delete", undefined, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
