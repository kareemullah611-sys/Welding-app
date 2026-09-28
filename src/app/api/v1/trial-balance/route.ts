import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange } from "@/lib/date-range";
import { buildTrialBalance, filterTrialBalanceRows, normalizeCurrency } from "@/lib/trial-balance";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("date_from");
    const dateTo = sp.get("date_to");
    const cityIdParam = sp.get("city_id");
    const currencyParam = sp.get("currency");
    const accountTypeParam = sp.get("account_type");
    const searchParam = sp.get("q");

    if (!dateFrom || !dateTo) {
      return errorResponse("VALIDATION_ERROR", "date_from and date_to are required");
    }

    const range = buildDateRange(dateFrom, dateTo);
    if (!range.gte || !range.lt) {
      return errorResponse("VALIDATION_ERROR", "Invalid date range");
    }

    const cityId = cityIdParam ? parseInt(cityIdParam) : undefined;
    if (cityIdParam && (isNaN(cityId!) || cityId! <= 0)) {
      return errorResponse("VALIDATION_ERROR", "Invalid city_id");
    }

    // Step 1: Fetch accounts that are active OR have journal entries.
    const directAccounts = await prisma.account.findMany({
      where: { OR: [{ isActive: true }, { journalEntries: { some: {} } }] },
      select: { id: true, code: true, name: true, accountType: true, cityId: true, parentId: true },
    });

    // Step 2: Include inactive parent accounts that have active children,
    // so child accounts can inherit the parent's family classification.
    const directIds = new Set(directAccounts.map((a) => a.id));
    const missingParentIds = directAccounts
      .filter((a) => a.parentId && !directIds.has(a.parentId))
      .map((a) => a.parentId!);

    let parentAccounts: typeof directAccounts = [];
    if (missingParentIds.length > 0) {
      parentAccounts = await prisma.account.findMany({
        where: { id: { in: missingParentIds } },
        select: { id: true, code: true, name: true, accountType: true, cityId: true, parentId: true },
      });
    }

    const accounts = [...directAccounts, ...parentAccounts];

    const relevantAccounts = cityId
      ? accounts.filter((a) => !a.cityId || a.cityId === cityId)
      : accounts;
    const accountIds = relevantAccounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return successResponse({
        sections: [],
        currencyTotals: {},
        reconciliation: [],
        allBalanced: true,
        reconciliationMeaningful: true,
        filters: { dateFrom, dateTo, cityId: cityId || "all", currency: currencyParam || "all" },
      });
    }

    const cityFilter = cityId ? { cityId } : {};

    // Build currency filter that includes legacy RMB when CNY is requested
    let currencyWhere: Record<string, unknown> | undefined;
    if (currencyParam) {
      const normalized = normalizeCurrency(currencyParam);
      if (normalized === "CNY") {
        currencyWhere = { currencyCode: { in: ["CNY", "RMB"] } };
      } else {
        currencyWhere = { currencyCode: normalized };
      }
    }

    const [openingGroups, periodGroups] = await Promise.all([
      prisma.journalEntry.groupBy({
        by: ["accountId", "currencyCode"],
        where: {
          accountId: { in: accountIds },
          entryDate: { lt: range.gte },
          ...cityFilter,
          ...(currencyWhere || {}),
        },
        _sum: { debit: true, credit: true },
      }),
      prisma.journalEntry.groupBy({
        by: ["accountId", "currencyCode"],
        where: {
          accountId: { in: accountIds },
          entryDate: { gte: range.gte, lt: range.lt },
          ...cityFilter,
          ...(currencyWhere || {}),
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const result = buildTrialBalance({
      accounts: relevantAccounts,
      openingGroups,
      periodGroups,
    });

    // Currency filter produces a complete single-currency ledger that should reconcile.
    // Only search and account-type filters produce subsets where reconciliation is meaningless.
    const hasSubsetFilters = !!(searchParam || accountTypeParam);

    const filtered = filterTrialBalanceRows(result, {
      search: searchParam || undefined,
      accountType: accountTypeParam || undefined,
      currency: currencyParam ? normalizeCurrency(currencyParam) : undefined,
    });

    return successResponse({
      ...filtered,
      reconciliationMeaningful: !hasSubsetFilters,
      filters: {
        dateFrom,
        dateTo,
        cityId: cityId || "all",
        currency: currencyParam || "all",
        accountType: accountTypeParam || "all",
        search: searchParam || "",
      },
    });
  } catch (error) {
    console.error("Trial balance error:", error);
    return serverError();
  }
});
