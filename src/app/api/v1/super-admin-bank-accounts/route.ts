import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can access these bank accounts", 403);
    }

    const accounts = await prisma.superAdminBankAccount.findMany({
      include: {
        currency: true,
        _count: { select: { expenses: { where: { deletedAt: null } } } },
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });

    return successResponse(accounts.map((a: any) => ({
      id: a.id,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      currency: a.currency,
      currencyId: a.currencyId,
      isActive: a.isActive,
      createdAt: a.createdAt.toISOString(),
      expenseCount: a._count.expenses,
    })));
  } catch {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can create these bank accounts", 403);
    }

    const body = await request.json();
    const bankName = String(body.bankName || "").trim();
    const accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
    const currencyId = Number(body.currencyId);

    if (!bankName) return errorResponse("VALIDATION_ERROR", "Bank name is required");
    if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "Currency is required");

    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);

    const account = await prisma.superAdminBankAccount.create({
      data: {
        bankName,
        accountNumber,
        currencyId,
        createdBy: user.userId,
      },
      include: { currency: true },
    });

    await createAuditLog(
      user.userId,
      null,
      "super_admin_bank_accounts",
      account.id,
      "create",
      undefined,
      { bankName, accountNumber, currency: currency.code },
      getClientIP(request)
    );

    return successResponse({
      id: account.id,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      currency: account.currency,
      currencyId: account.currencyId,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
    }, "Super admin bank account created", 201);
  } catch {
    return serverError();
  }
});
