import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const accounts = await prisma.superAdminBankAccount.findMany({
        include: {
          currency: true,
          _count: {
            select: {
              expenses: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      });

      return successResponse(
        accounts.map((a) => ({
          id: a.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          currencyId: a.currencyId,
          currency: a.currency,
          isActive: a.isActive,
          createdAt: a.createdAt.toISOString(),
          _count: {
            deposits: 0,
            hajiTransfers: 0,
            expenses: a._count.expenses,
          },
          accountScope: "super_admin",
        }))
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedCityId = searchParams.get("cityId") ? parseInt(searchParams.get("cityId")!) : undefined;
    const cityId = getCityScope(user, requestedCityId);

    const where: any = {};
    if (cityId) where.cityId = cityId;

    const accounts = await prisma.bankAccount.findMany({
      where,
      include: {
        city: { select: { id: true, name: true } },
        _count: {
          select: {
            deposits: true,
            hajiTransfers: true,
            expenses: true,
          },
        },
      },
      orderBy: [{ cityId: "asc" }, { createdAt: "desc" }],
    });

    return successResponse(
      accounts.map((a) => ({
        id: a.id,
        cityId: a.cityId,
        cityName: a.city.name,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
        _count: {
          deposits: a._count.deposits,
          hajiTransfers: a._count.hajiTransfers,
          expenses: a._count.expenses,
        },
      }))
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const body = await request.json();
      const bankName: string = (body.bankName || "").trim();
      if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName is required");
      if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");

      const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;
      const currencyId = Number(body.currencyId);
      if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "currencyId is required");

      const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);

      const account = await prisma.superAdminBankAccount.create({
        data: {
          bankName,
          accountNumber,
          currencyId,
          isActive: true,
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
        { bankName, accountNumber, currencyId },
        getClientIP(request)
      );

      return successResponse(
        {
          id: account.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          currencyId: account.currencyId,
          currency: account.currency,
          isActive: account.isActive,
          createdAt: account.createdAt.toISOString(),
          accountScope: "super_admin",
        },
        "Bank account created",
        201
      );
    }
    const body = await request.json();
    const cityId = user.cityId!;

    // Validate bankName
    const bankName: string = (body.bankName || "").trim();
    if (!bankName) {
      return errorResponse("VALIDATION_ERROR", "bankName is required");
    }
    if (bankName.length > 100) {
      return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
    }

    const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;

    const account = await prisma.bankAccount.create({
      data: {
        cityId,
        bankName,
        accountNumber,
        isActive: true,
      },
      include: {
        city: { select: { id: true, name: true } },
      },
    });

    await createAuditLog(
      user.userId,
      cityId,
      "bank_accounts",
      account.id,
      "create",
      undefined,
      { bankName, accountNumber, cityId },
      getClientIP(request)
    );

    return successResponse(
      {
        id: account.id,
        cityId: account.cityId,
        cityName: account.city.name,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        isActive: account.isActive,
        createdAt: account.createdAt.toISOString(),
      },
      "Bank account created",
      201
    );
  } catch (error) {
    return serverError();
  }
});
