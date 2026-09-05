import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { serverError, successResponse } from "@/lib/api-response";

export const GET = withSuperAdmin(async (_request: NextRequest) => {
  try {
    const [currencies, superAdminAccounts, intermediaries, cities, counterAccounts] = await Promise.all([
      prisma.currency.findMany({ orderBy: { code: "asc" } }),
      prisma.superAdminBankAccount.findMany({
        where: { isActive: true },
        include: { currency: { select: { id: true, code: true, symbol: true } } },
        orderBy: [{ accountKind: "asc" }, { bankName: "asc" }],
      }),
      prisma.intermediary.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.city.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          bankAccounts: { where: { isActive: true }, select: { id: true, bankName: true, accountNumber: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { isActive: true, accountType: { in: ["asset", "expense", "cogs"] } },
        select: { id: true, code: true, name: true, accountType: true },
        orderBy: [{ accountType: "asc" }, { code: "asc" }],
      }),
    ]);
    return successResponse({ currencies, superAdminAccounts, intermediaries, cities, counterAccounts });
  } catch (error) {
    console.error("Read superadmin liability options:", error);
    return serverError();
  }
});
