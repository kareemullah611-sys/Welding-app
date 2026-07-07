import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

async function balanceForAccounts(accountIds: number[]) {
  if (accountIds.length === 0) return {};
  const [entries, openings] = await Promise.all([
    prisma.cityLiabilityEntry.groupBy({
      by: ["accountId", "currencyId", "entryType"],
      where: { accountId: { in: accountIds } },
      _sum: { amount: true },
    }),
    prisma.openingCityLiability.groupBy({
      by: ["accountId", "currencyId"],
      where: { accountId: { in: accountIds } },
      _sum: { amount: true },
    }),
  ]);
  const currencyIds = Array.from(new Set([...entries.map((e) => e.currencyId), ...openings.map((o) => o.currencyId)]));
  const currencies = currencyIds.length
    ? await prisma.currency.findMany({ where: { id: { in: currencyIds } }, select: { id: true, code: true } })
    : [];
  const codeById = Object.fromEntries(currencies.map((c) => [c.id, c.code]));
  const balances: Record<number, Record<string, number>> = {};
  for (const opening of openings) {
    const code = codeById[opening.currencyId] || `CUR${opening.currencyId}`;
    balances[opening.accountId] = balances[opening.accountId] || {};
    balances[opening.accountId][code] = (balances[opening.accountId][code] || 0) + Number(opening._sum.amount || 0);
  }
  for (const entry of entries) {
    const code = codeById[entry.currencyId] || `CUR${entry.currencyId}`;
    balances[entry.accountId] = balances[entry.accountId] || {};
    const signed = entry.entryType === "charge" ? Number(entry._sum.amount || 0) : -Number(entry._sum.amount || 0);
    balances[entry.accountId][code] = (balances[entry.accountId][code] || 0) + signed;
  }
  for (const accountId of Object.keys(balances)) {
    balances[Number(accountId)] = Object.fromEntries(Object.entries(balances[Number(accountId)]).map(([code, amount]) => [code, round2(amount)]));
  }
  return balances;
}

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can access liabilities", 403);
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const query = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const where: any = { cityId: user.cityId };
    if (query.length >= 2) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
      ];
    }

    const [accounts, total] = await Promise.all([
      prisma.cityLiabilityAccount.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: limit }),
      prisma.cityLiabilityAccount.count({ where }),
    ]);
    const balances = await balanceForAccounts(accounts.map((a) => a.id));
    return paginatedResponse(accounts.map((account) => {
      const balanceByCurrency = balances[account.id] || {};
      return {
        id: account.id,
        cityId: account.cityId,
        name: account.name,
        phone: account.phone,
        notes: account.notes,
        isActive: account.isActive,
        balanceByCurrency,
        balance: round2(Object.values(balanceByCurrency).reduce((sum, value) => sum + Number(value || 0), 0)),
      };
    }), total, page, limit);
  } catch (error) {
    console.error("List liabilities error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can create liabilities", 403);
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return validationError("Liability name is required");
    const cityId = user.cityId!;
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.cityLiabilityAccount.create({
        data: {
          cityId,
          name,
          phone: body.phone ? String(body.phone).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
          createdBy: user.userId,
        },
      });
      await createAuditLog(user.userId, cityId, "city_liability_accounts", created.id, "create", undefined, { name }, getClientIP(request), tx);
      return created;
    });
    return successResponse(account, "Liability created", 201);
  } catch (error: any) {
    if (error?.code === "P2002") return validationError("Liability name already exists for this city");
    console.error("Create liability error:", error);
    return serverError();
  }
});
