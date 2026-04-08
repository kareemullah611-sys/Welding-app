import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const id = parseInt(context.params.id);
      if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

      const account = await prisma.superAdminBankAccount.findUnique({ where: { id } });
      if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

      const body = await request.json();
      const updateData: any = {};

      if (body.bankName !== undefined) {
        const bankName = String(body.bankName).trim();
        if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName cannot be empty");
        if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
        updateData.bankName = bankName;
      }

      if (body.accountNumber !== undefined) {
        updateData.accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
      }

      if (body.isActive !== undefined) {
        updateData.isActive = Boolean(body.isActive);
      }

      if (body.currencyId !== undefined) {
        const currencyId = Number(body.currencyId);
        if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "currencyId is required");
        const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
        if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);
        updateData.currencyId = currencyId;
      }

      if (Object.keys(updateData).length === 0) {
        return errorResponse("VALIDATION_ERROR", "No valid fields to update");
      }

      const oldValues = {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        isActive: account.isActive,
        currencyId: account.currencyId,
      };

      const updated = await prisma.superAdminBankAccount.update({
        where: { id },
        data: updateData,
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_bank_accounts",
        id,
        "update",
        oldValues,
        updateData,
        getClientIP(request)
      );

      return successResponse(
        {
          id: updated.id,
          cityId: null,
          bankName: updated.bankName,
          accountNumber: updated.accountNumber,
          isActive: updated.isActive,
          currencyId: updated.currencyId,
          accountScope: "super_admin",
        },
        "Bank account updated"
      );
    }
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

    // city_admin can only modify accounts in their own city
    if (user.role === "city_admin" && account.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    const body = await request.json();
    const updateData: any = {};

    if (body.bankName !== undefined) {
      const bankName = String(body.bankName).trim();
      if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName cannot be empty");
      if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
      updateData.bankName = bankName;
    }

    if (body.accountNumber !== undefined) {
      updateData.accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
    }

    if (body.isActive !== undefined) {
      updateData.isActive = Boolean(body.isActive);
    }

    if (Object.keys(updateData).length === 0) {
      return errorResponse("VALIDATION_ERROR", "No valid fields to update");
    }

    const oldValues = {
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      isActive: account.isActive,
    };

    const updated = await prisma.bankAccount.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog(
      user.userId,
      account.cityId,
      "bank_accounts",
      id,
      "update",
      oldValues,
      updateData,
      getClientIP(request)
    );

    return successResponse(
      {
        id: updated.id,
        cityId: updated.cityId,
        bankName: updated.bankName,
        accountNumber: updated.accountNumber,
        isActive: updated.isActive,
      },
      "Bank account updated"
    );
  } catch (error) {
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const id = parseInt(context.params.id);
      if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

      const account = await prisma.superAdminBankAccount.findUnique({ where: { id } });
      if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);
      if (!account.isActive) return errorResponse("VALIDATION_ERROR", "Bank account is already inactive");

      await prisma.superAdminBankAccount.update({
        where: { id },
        data: { isActive: false },
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_bank_accounts",
        id,
        "delete",
        { bankName: account.bankName, accountNumber: account.accountNumber, isActive: true, currencyId: account.currencyId },
        { isActive: false },
        getClientIP(request)
      );

      return successResponse({ id }, "Bank account deactivated");
    }
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

    // city_admin can only modify accounts in their own city
    if (user.role === "city_admin" && account.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    if (!account.isActive) {
      return errorResponse("VALIDATION_ERROR", "Bank account is already inactive");
    }

    // Soft-delete: set isActive = false instead of removing the row
    await prisma.bankAccount.update({
      where: { id },
      data: { isActive: false },
    });

    await createAuditLog(
      user.userId,
      account.cityId,
      "bank_accounts",
      id,
      "delete",
      { bankName: account.bankName, accountNumber: account.accountNumber, isActive: true },
      { isActive: false },
      getClientIP(request)
    );

    return successResponse({ id }, "Bank account deactivated");
  } catch (error) {
    return serverError();
  }
});
