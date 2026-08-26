import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalHajiTransfer } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { resolveAfghanistanSettlement } from "@/lib/afghanistan-haji-settlement";
import {
  getHajiTransferAuditStateMap,
  isAfghanistanHajiSettlementEligible,
  isHajiTransferAuditConfirmed,
} from "@/lib/haji-transfer-audit";
import {
  resolvePakistanDestinationAccount,
  transferredToLabelForPakistanDestination,
} from "@/lib/pakistan-haji-destination";
import { getSaCheckAuditStateMap, isSaCheckConfirmed } from "@/lib/sa-check-audit";
import { isAfghanistanCountry, isPakistanCountry } from "@/lib/country-code";

function journalInputFromTransfer(transfer: any, createdBy: number) {
  return {
    id: transfer.id,
    cityId: transfer.cityId,
    lotId: transfer.lotId,
    amount: Number(transfer.amount),
    currencyCode: transfer.currency.code,
    date: transfer.transferDate,
    createdBy,
    sourceType: transfer.sourceType ?? null,
    bankAccountId: transfer.bankAccountId ?? null,
    settlementDestination: transfer.settlementDestination ?? "standard",
    intermediaryId: transfer.intermediaryId ?? null,
    superAdminCashAccountId: transfer.superAdminCashAccountId ?? null,
    superAdminBankAccountId: transfer.superAdminBankAccountId ?? null,
  };
}

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const h = await prisma.hajiTransfer.findUnique({
      where: { id },
      include: { currency: true, city: { include: { country: true } } },
    });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    const isAfghanistan = isAfghanistanCountry(h.city.country);
    const isPakistan = isPakistanCountry(h.city.country);
    const auditEligible = isAfghanistanHajiSettlementEligible(h);

    if (body.action === "set_sa_check") {
      if (user.role !== "super_admin") {
        return errorResponse("FORBIDDEN", "Only super admin can verify Haji transfers", 403);
      }

      const confirmed = !!body.confirmed;
      const auditMap = await getSaCheckAuditStateMap("haji_transfers", [id]);
      const current = auditMap[id];
      await createAuditLog(
        user.userId,
        h.cityId,
        "haji_transfers",
        id,
        "update",
        {
          saCheckConfirmed: current?.confirmed || false,
          saCheckConfirmedAt: current?.confirmedAt || null,
          saCheckConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
        },
        {
          saCheckConfirmed: confirmed,
          saCheckNote: confirmed ? "Super admin verified Haji transfer" : "Super admin removed Haji transfer verification",
        },
        getClientIP(request)
      );
      return successResponse({
        id,
        saCheck: {
          confirmed,
          confirmedAt: new Date().toISOString(),
          confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
        },
      }, confirmed ? "Haji transfer verified" : "Haji transfer verification removed");
    }

    if (body.action === "set_haji_audit") {
      if (user.role !== "super_admin") {
        return errorResponse("FORBIDDEN", "Only super admin can confirm Haji settlement audit", 403);
      }
      if (!auditEligible) {
        return errorResponse("VALIDATION_ERROR", "Only Afghanistan cash settlements can be audit-confirmed");
      }
      const confirmed = !!body.confirmed;
      const auditMap = await getHajiTransferAuditStateMap([id]);
      const current = auditMap[id];
      await createAuditLog(
        user.userId,
        h.cityId,
        "haji_transfers",
        id,
        "update",
        {
          hajiAuditConfirmed: current?.confirmed || false,
          hajiAuditConfirmedAt: current?.confirmedAt || null,
          hajiAuditConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
        },
        {
          hajiAuditConfirmed: confirmed,
          hajiAuditNote: confirmed
            ? "Super admin confirmed Afghanistan Haji settlement"
            : "Super admin removed Haji settlement confirmation",
        },
        getClientIP(request)
      );
      return successResponse({
        id,
        hajiAudit: {
          confirmed,
          confirmedAt: new Date().toISOString(),
          confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
        },
      }, confirmed ? "Settlement audit confirmed" : "Settlement audit unconfirmed");
    }

    if (await isHajiTransferAuditConfirmed(id) || await isSaCheckConfirmed("haji_transfers", id)) {
      return errorResponse("FORBIDDEN", "Cannot edit a settlement after audit confirmation", 403);
    }

    if ((h as any).chequePaymentId && body.amount !== undefined && Number(body.amount) !== Number(h.amount)) {
      return errorResponse("VALIDATION_ERROR", "Cannot change the amount of a transfer that was funded by a cheque");
    }

    if (isAfghanistan && body.sourceType && body.sourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city Haji transfers can only use office cash");
    }

    const nextTransferDate = body.transferDate ? new Date(body.transferDate) : h.transferDate;
    if (Number.isNaN(nextTransferDate.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid transfer date");
    const nextSourceType = body.sourceType ?? ((h as any).sourceType ?? "cash_office");
    const nextTransferType = nextSourceType === "bank_transfer" ? "direct" : "from_in_hand";
    const nextBankAccountId = nextSourceType === "bank_transfer"
      ? (body.bankAccountId ? parseInt(body.bankAccountId) : ((h as any).bankAccountId ?? null))
      : null;

    if ((h as any).chequePaymentId) {
      const sourceChanged = nextSourceType !== ((h as any).sourceType ?? "cheque");
      if (sourceChanged) {
        return errorResponse("VALIDATION_ERROR", "Cannot change source for a transfer that was funded by a cheque");
      }
    }
    if (["cheque", "mixed_cash_cheque"].includes(nextSourceType) && !(h as any).chequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque-funded transfer source cannot be selected during edit");
    }
    if (nextSourceType === "bank_transfer") {
      if (!nextBankAccountId) return errorResponse("VALIDATION_ERROR", "Please select a bank account");
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!bankAccount || !bankAccount.isActive) return errorResponse("NOT_FOUND", "Selected bank account not found", 404);
      if (bankAccount.cityId !== h.cityId) return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
    }

    let transferredTo = body.transferredTo !== undefined ? body.transferredTo : h.transferredTo;
    let settlementDestination = h.settlementDestination ?? "standard";
    let intermediaryId = h.intermediaryId;
    let superAdminCashAccountId = h.superAdminCashAccountId;
    let superAdminBankAccountId = h.superAdminBankAccountId;

    if (isPakistan) {
      const hasDestinationUpdate =
        body.superAdminDestinationAccountId != null
        || body.transferredTo !== undefined;
      if (hasDestinationUpdate) {
        const pakistanDestination = await resolvePakistanDestinationAccount(
          body.superAdminDestinationAccountId,
          body.transferredTo ?? h.transferredTo,
        );
        if (pakistanDestination.settlementDestination === "super_admin_cash") {
          settlementDestination = "super_admin_cash";
          superAdminCashAccountId = pakistanDestination.superAdminCashAccountId ?? null;
          superAdminBankAccountId = null;
        } else if (pakistanDestination.superAdminBankAccountId) {
          settlementDestination = "standard";
          superAdminBankAccountId = pakistanDestination.superAdminBankAccountId;
          superAdminCashAccountId = null;
        }
        transferredTo = await transferredToLabelForPakistanDestination(
          pakistanDestination,
          body.transferredTo ?? h.transferredTo,
        );
      } else {
        transferredTo = h.transferredTo;
      }
    }

    if (isAfghanistan) {
      const settlement = await resolveAfghanistanSettlement(prisma, {
        settlementDestination: body.settlementDestination ?? h.settlementDestination,
        intermediaryId: body.intermediaryId ?? h.intermediaryId,
        superAdminCashAccountId: body.superAdminCashAccountId ?? h.superAdminCashAccountId,
        currencyId: h.currencyId,
      });
      if (!settlement.ok) return errorResponse("VALIDATION_ERROR", settlement.message);
      settlementDestination = settlement.data.settlementDestination;
      intermediaryId = settlement.data.intermediaryId;
      superAdminCashAccountId = settlement.data.superAdminCashAccountId;
      transferredTo = settlement.data.transferredTo;
    }

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
          transferDate: nextTransferDate,
          amount: body.amount || h.amount,
          detail: body.detail || h.detail,
          transferredTo,
          ...(body.referenceNo !== undefined
            ? { referenceNo: typeof body.referenceNo === "string" && body.referenceNo.trim() ? body.referenceNo.trim() : null }
            : {}),
          settlementDestination,
          intermediaryId,
          superAdminCashAccountId,
          superAdminBankAccountId,
          transferType: nextTransferType,
          sourceType: nextSourceType,
          bankAccountId: nextBankAccountId,
          notes: body.notes !== undefined ? body.notes : h.notes,
          updatedAt: new Date(),
        } as any,
        include: { currency: true },
      });

      await journalHajiTransfer(journalInputFromTransfer(updated, user.userId), tx);

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
  } catch (error) {
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const h = await prisma.hajiTransfer.findUnique({ where: { id } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }
    if (await isHajiTransferAuditConfirmed(id)) {
      return errorResponse("FORBIDDEN", "Cannot delete a settlement after audit confirmation", 403);
    }

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`HAJI-${id}`, user.userId, tx);

      const chequePaymentId = (h as any).chequePaymentId;
      if (chequePaymentId) {
        await tx.payment.update({ where: { id: chequePaymentId }, data: { chequeStatus: "in_hand" } as any });
      }

      await tx.hajiTransfer.delete({ where: { id } });
      await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "delete", undefined, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Deleted");
  } catch (error) {
    return serverError();
  }
});
