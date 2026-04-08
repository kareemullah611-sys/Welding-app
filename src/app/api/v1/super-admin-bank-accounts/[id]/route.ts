import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can modify these bank accounts", 403);
    }

    const id = Number(context.params.id);
    const body = await request.json();
    const account = await prisma.superAdminBankAccount.findUnique({ where: { id }, include: { currency: true } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

    const bankName = body.bankName !== undefined ? String(body.bankName || "").trim() : account.bankName;
    const accountNumber = body.accountNumber !== undefined ? (body.accountNumber ? String(body.accountNumber).trim() : null) : account.accountNumber;
    const isActive = body.isActive !== undefined ? Boolean(body.isActive) : account.isActive;
    const currencyId = body.currencyId !== undefined ? Number(body.currencyId) : account.currencyId;

    if (!bankName) return errorResponse("VALIDATION_ERROR", "Bank name is required");
    if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "Currency is required");

    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);

    const updated = await prisma.superAdminBankAccount.update({
      where: { id },
      data: { bankName, accountNumber, isActive, currencyId },
      include: { currency: true },
    });

    await createAuditLog(
      user.userId,
      null,
      "super_admin_bank_accounts",
      id,
      "update",
      {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        currency: account.currency.code,
        isActive: account.isActive,
      },
      {
        bankName: updated.bankName,
        accountNumber: updated.accountNumber,
        currency: updated.currency.code,
        isActive: updated.isActive,
      },
      getClientIP(request)
    );

    return successResponse({ id }, "Super admin bank account updated");
  } catch {
    return serverError();
  }
});
