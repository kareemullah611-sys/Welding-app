import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange } from "@/lib/date-range";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can access liabilities", 403);
    const id = Number(context.params.id);
    const dateFrom = request.nextUrl.searchParams.get("date_from");
    const dateTo = request.nextUrl.searchParams.get("date_to");
    const account = await prisma.cityLiabilityAccount.findUnique({ where: { id }, include: { city: true } });
    if (!account) return errorResponse("NOT_FOUND", "Liability not found", 404);
    if (account.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const dateFilter = buildDateRange(dateFrom, dateTo);

    const [openings, entries] = await Promise.all([
      prisma.openingCityLiability.findMany({
        where: { accountId: id, ...(Object.keys(dateFilter).length ? { openingDate: dateFilter } : {}) },
        include: { currency: true },
        orderBy: { openingDate: "asc" },
      }),
      prisma.cityLiabilityEntry.findMany({
        where: { accountId: id, ...(Object.keys(dateFilter).length ? { entryDate: dateFilter } : {}) },
        include: {
          currency: true,
          lot: { select: { lotNumber: true } },
          bankAccount: { select: { bankName: true, accountNumber: true } },
        },
        orderBy: [{ entryDate: "asc" }, { id: "asc" }],
      }),
    ]);

    const transactions = [
      ...openings.map((opening) => ({
        type: "opening",
        date: opening.openingDate.toISOString().split("T")[0],
        detail: "Opening liability",
        debit: 0,
        credit: Number(opening.amount),
        currency: opening.currency.code,
        currencySymbol: opening.currency.symbol || opening.currency.code,
        lotNumber: "-",
        referenceNo: "OPEN",
      })),
      ...entries.map((entry) => ({
        type: entry.entryType,
        date: entry.entryDate.toISOString().split("T")[0],
        detail: entry.detail,
        debit: entry.entryType === "payment" ? Number(entry.amount) : 0,
        credit: entry.entryType === "charge" ? Number(entry.amount) : 0,
        currency: entry.currency.code,
        currencySymbol: entry.currency.symbol || entry.currency.code,
        lotNumber: entry.lot?.lotNumber || "-",
        referenceNo: entry.referenceNo || "-",
        note: entry.note,
        paymentSource: entry.paymentSource,
        bankName: entry.bankAccount ? `${entry.bankAccount.bankName}${entry.bankAccount.accountNumber ? ` (${entry.bankAccount.accountNumber})` : ""}` : null,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const runningByCurrency: Record<string, number> = {};
    const ledger = transactions.map((entry) => {
      runningByCurrency[entry.currency] = (runningByCurrency[entry.currency] || 0) + entry.credit - entry.debit;
      return { ...entry, balance: round2(runningByCurrency[entry.currency]) };
    });
    const balanceByCurrency = Object.fromEntries(Object.entries(runningByCurrency).map(([code, amount]) => [code, round2(amount)]));

    return successResponse({
      id: account.id,
      name: account.name,
      phone: account.phone,
      notes: account.notes,
      isActive: account.isActive,
      city: account.city.name,
      balanceByCurrency,
      balance: round2(Object.values(balanceByCurrency).reduce((sum, value) => sum + Number(value || 0), 0)),
      ledger: [...ledger].reverse(),
    });
  } catch (error) {
    console.error("Liability ledger error:", error);
    return serverError();
  }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can update liabilities", 403);
    const id = Number(context.params.id);
    const body = await request.json();
    const account = await prisma.cityLiabilityAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Liability not found", 404);
    if (account.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    const name = body.name !== undefined ? String(body.name || "").trim() : account.name;
    if (!name) return validationError("Liability name is required");
    const updated = await prisma.cityLiabilityAccount.update({
      where: { id },
      data: {
        name,
        phone: body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : account.phone,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : account.notes,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : account.isActive,
      },
    });
    await createAuditLog(user.userId, account.cityId, "city_liability_accounts", id, "update", { name: account.name }, { name: updated.name }, getClientIP(request));
    return successResponse(updated, "Liability updated");
  } catch (error: any) {
    if (error?.code === "P2002") return validationError("Liability name already exists for this city");
    console.error("Update liability error:", error);
    return serverError();
  }
});

export const DELETE = withAuth(async (_request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can deactivate liabilities", 403);
    const id = Number(context.params.id);
    const account = await prisma.cityLiabilityAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Liability not found", 404);
    if (account.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    await prisma.cityLiabilityAccount.update({ where: { id }, data: { isActive: false } });
    return successResponse({ id }, "Liability deactivated");
  } catch (error) {
    console.error("Deactivate liability error:", error);
    return serverError();
  }
});
