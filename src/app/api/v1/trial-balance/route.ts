import { NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  buildTrialBalance,
  filterTrialBalanceRows,
  normalizeCurrency,
  reconciliationIsMeaningful,
  AccountHierarchyError,
} from "@/lib/trial-balance";
import { loadTrialBalanceSource } from "@/lib/trial-balance-source";
import { parseBusinessDateParam, parseCityIdParam } from "@/lib/report-params";

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

    const fromCheck = parseBusinessDateParam(dateFrom, "date_from");
    if (fromCheck.errorMessage) return errorResponse("VALIDATION_ERROR", fromCheck.errorMessage);
    const toCheck = parseBusinessDateParam(dateTo, "date_to");
    if (toCheck.errorMessage) return errorResponse("VALIDATION_ERROR", toCheck.errorMessage);

    const cityCheck = await parseCityIdParam(cityIdParam);
    if (cityCheck.errorMessage) return errorResponse("VALIDATION_ERROR", cityCheck.errorMessage);
    const cityId = cityCheck.cityId;

    let source;
    try {
      source = await loadTrialBalanceSource({ dateFrom, dateTo, cityId, currencyParam });
    } catch (error) {
      if (error instanceof AccountHierarchyError) {
        return errorResponse("ACCOUNT_HIERARCHY_INVALID", error.message);
      }
      throw error;
    }

    if (source.relevantAccountIds.length === 0) {
      return successResponse({
        sections: [],
        currencyTotals: {},
        reconciliation: [],
        allBalanced: true,
        reconciliationMeaningful: reconciliationIsMeaningful({ search: searchParam, accountType: accountTypeParam }),
        filters: { dateFrom, dateTo, cityId: cityId || "all", currency: currencyParam || "all" },
      });
    }

    const result = buildTrialBalance({
      accounts: source.accounts,
      openingGroups: source.openingGroups,
      periodGroups: source.periodGroups,
    });

    // Shared predicate with the XLSX export: only search and account-type filters
    // produce subsets where reconciliation is meaningless.
    const filtered = filterTrialBalanceRows(result, {
      search: searchParam || undefined,
      accountType: accountTypeParam || undefined,
      currency: currencyParam ? normalizeCurrency(currencyParam) : undefined,
    });

    return successResponse({
      ...filtered,
      reconciliationMeaningful: reconciliationIsMeaningful({ search: searchParam, accountType: accountTypeParam }),
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
