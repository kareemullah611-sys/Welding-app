import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
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
      return errorResponse("FORBIDDEN", "Super admin can view bank accounts but city admins manage city bank accounts", 403);
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
