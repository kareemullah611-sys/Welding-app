import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalCityLiabilityCharge, journalCityLiabilityPayment } from "@/lib/accounting";

function dateOnly(value?: string | null) {
  return value ? new Date(value) : new Date();
}

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can create liability entries", 403);
    const accountId = Number(context.params.id);
    const body = await request.json();
    const cityId = user.cityId!;
    const account = await prisma.cityLiabilityAccount.findUnique({ where: { id: accountId } });
    if (!account) return errorResponse("NOT_FOUND", "Liability not found", 404);
    if (account.cityId !== cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const entryType = String(body.entryType || "");
    const amount = Number(body.amount || 0);
    const currencyId = Number(body.currencyId || 0);
    const detail = String(body.detail || "").trim();
    const entryDate = dateOnly(body.entryDate);
    if (!["charge", "payment"].includes(entryType)) return validationError("Invalid liability entry type");
    if (!(amount > 0)) return validationError("Amount must be greater than zero");
    if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
    if (!detail) return validationError("Detail is required");

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");
    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) return errorResponse("NOT_FOUND", "Currency not found");

    let lotId: number | null = null;
    if (entryType === "charge") {
      lotId = Number(body.lotId || 0);
      if (!Number.isInteger(lotId) || lotId <= 0) return validationError("Lot is required");
      const lot = await prisma.lot.findFirst({
        where: { id: lotId, status: "ongoing", lotCityDistributions: { some: { cityId } } },
      });
      if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");
    }

    const paymentSource = entryType === "payment" ? String(body.paymentSource || "cash_office") : null;
    const bankAccountId = paymentSource === "bank_account" ? Number(body.bankAccountId || 0) : 0;
    const chequePaymentId = paymentSource === "cheque" ? Number(body.chequePaymentId || 0) : 0;
    if (entryType === "payment" && !["cash_office", "cheque", "bank_account"].includes(paymentSource || "")) return validationError("Invalid payment source");
    if (paymentSource === "bank_account" && (!Number.isInteger(bankAccountId) || bankAccountId <= 0)) return validationError("Bank account is required");
    if (paymentSource === "cheque" && (!Number.isInteger(chequePaymentId) || chequePaymentId <= 0)) return validationError("Cheque is required");

    if (paymentSource === "bank_account" && bankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found", 404);
      if (bankAccount.cityId !== cityId) return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
      if (!bankAccount.isActive) return errorResponse("VALIDATION_ERROR", "Bank account is inactive");
    }

    const entry = await prisma.$transaction(async (tx) => {
      if (paymentSource === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(32005, ${chequePaymentId}::int)`;
        const chequePayment = await tx.payment.findUnique({ where: { id: chequePaymentId } });
        if (!chequePayment) throw new Error("CHEQUE_NOT_FOUND");
        if (chequePayment.cityId !== cityId) throw new Error("CHEQUE_FORBIDDEN");
        if ((chequePayment as any).paymentMethod !== "cheque") throw new Error("CHEQUE_NOT_CHEQUE");
        if ((chequePayment as any).chequeStatus !== "in_hand") throw new Error("CHEQUE_NOT_IN_HAND");
        const claimed = await tx.payment.updateMany({
          where: { id: chequePaymentId, chequeStatus: "in_hand" as any },
          data: { chequeStatus: "used_for_liability" as any },
        });
        if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");
      }

      const created = await tx.cityLiabilityEntry.create({
        data: {
          accountId,
          cityId,
          lotId,
          currencyId,
          entryDate,
          entryType: entryType as any,
          amount,
          detail,
          note: body.note ? String(body.note).trim() : null,
          paymentSource: paymentSource as any,
          bankAccountId: bankAccountId || null,
          chequePaymentId: chequePaymentId || null,
          referenceNo: body.referenceNo ? String(body.referenceNo).trim() : null,
          createdBy: user.userId,
        } as any,
        include: { currency: true },
      });

      if (entryType === "charge") {
        await journalCityLiabilityCharge({
          id: created.id,
          accountId,
          cityId,
          lotId,
          amount: Number(created.amount),
          currencyCode: created.currency.code,
          detail,
          entryDate: created.entryDate,
          createdBy: user.userId,
        }, tx);
      } else {
        await journalCityLiabilityPayment({
          id: created.id,
          accountId,
          cityId,
          amount: Number(created.amount),
          currencyCode: created.currency.code,
          detail,
          entryDate: created.entryDate,
          createdBy: user.userId,
          paymentSource,
          bankAccountId: bankAccountId || null,
        }, tx);
      }

      await createAuditLog(user.userId, cityId, "city_liability_entries", created.id, "create", undefined, {
        accountId,
        entryType,
        amount,
        detail,
      }, getClientIP(request), tx);
      return created;
    });

    return successResponse({ id: entry.id }, "Liability entry saved", 201);
  } catch (error: any) {
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return validationError("Selected payment is not a cheque");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return validationError("Cheque is not available");
    console.error("Create liability entry error:", error);
    return serverError();
  }
});
