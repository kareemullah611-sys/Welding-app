import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    let isAfghanistanCityAdmin = false;
    if (user.role === "city_admin" && user.cityId) {
      const city = await prisma.city.findUnique({
        where: { id: user.cityId },
        select: { country: { select: { name: true } } },
      });
      isAfghanistanCityAdmin = city?.country?.name === "Afghanistan";
    }
    const isSuperAdmin = user.role === "super_admin";
    if (!isAfghanistanCityAdmin && !isSuperAdmin) {
      return errorResponse("FORBIDDEN", "Not allowed to load settlement options", 403);
    }

    const currencyIdRaw = request.nextUrl.searchParams.get("currencyId");
    const currencyId = currencyIdRaw ? parseInt(currencyIdRaw, 10) : NaN;
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      return errorResponse("VALIDATION_ERROR", "currencyId is required");
    }

    if (isAfghanistanCityAdmin) {
      const cityCurrency = await prisma.cityCurrency.findFirst({
        where: { cityId: user.cityId!, currencyId },
      });
      if (!cityCurrency) {
        return errorResponse("VALIDATION_ERROR", "Currency is not enabled for your city");
      }
    }

    const intermediaries = await prisma.intermediary.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    let superAdminCashAccounts: { id: number; bankName: string; currencyId: number; accountKind: string }[] = [];
    try {
      const rows = await prisma.superAdminBankAccount.findMany({
        where: { isActive: true, accountKind: "cash", currencyId },
        select: { id: true, bankName: true, currencyId: true, accountKind: true },
        orderBy: { bankName: "asc" },
      });
      superAdminCashAccounts = rows.map((a) => ({
        id: a.id,
        bankName: a.bankName,
        currencyId: a.currencyId,
        accountKind: a.accountKind,
      }));
    } catch (cashError) {
      console.error("Haji settlement cash accounts query failed (run db bootstrap):", cashError);
    }

    return successResponse({
      intermediaries,
      superAdminCashAccounts,
    });
  } catch (error) {
    console.error("Haji settlement options:", error);
    return serverError();
  }
});
