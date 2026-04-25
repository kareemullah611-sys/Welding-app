import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, paginatedResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getPaymentHajiAuditStateMap, isHajiAuditEligible } from "@/lib/payment-audit";

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1"));
    const limit = Math.max(1, Math.min(100, parseInt(sp.get("limit") || "20")));
    const typeFilter = sp.get("type") || "all";
    const destinationFilter = sp.get("destination");
    const fromDate = sp.get("from_date");
    const toDate = sp.get("to_date");
    const query = (sp.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericSearchText = shouldApplySearch ? normalizedQuery.replace(/[^0-9.]/g, "") : "";
    const numericQuery = numericSearchText ? Number(numericSearchText) : NaN;
    const hasNumericQuery = Number.isFinite(numericQuery);
    const compactQuery = normalizedQuery.replace(/[\s,]/g, "");
    const isNumericLikeQuery = shouldApplySearch && /^-?\d*\.?\d+$/.test(compactQuery);
    const queryDigits = normalizedQuery.replace(/[^\d]/g, "");
    const decimalPlaces = numericSearchText.includes(".") ? (numericSearchText.split(".")[1] || "").length : 0;
    const numericQueryUpper = hasNumericQuery
      ? numericQuery + (decimalPlaces > 0 ? Math.pow(10, -decimalPlaces) : 1)
      : NaN;
    const paymentMethodQuery = ["cash", "bank_transfer", "cheque", "online"].includes(normalizedQuery)
      ? normalizedQuery
      : null;
    const destinationQuery = ["our_account", "haji"].includes(normalizedQuery)
      ? normalizedQuery
      : null;
    const paymentStatusQuery = ["active", "cancelled"].includes(normalizedQuery)
      ? normalizedQuery
      : null;
    const transferTypeQuery = ["direct", "from_in_hand"].includes(normalizedQuery)
      ? normalizedQuery
      : null;
    const withdrawalStatusQuery = normalizedQuery === "approved" || normalizedQuery === "pending"
      ? normalizedQuery
      : null;

    const cityId = getCityScope(user, undefined);

    const dateWhere = (field: string) => {
      const w: any = {};
      if (fromDate) w[field] = { ...(w[field] || {}), gte: new Date(fromDate) };
      if (toDate) w[field] = { ...(w[field] || {}), lte: new Date(toDate + "T23:59:59") };
      return w;
    };

    const cityWhere = cityId ? { cityId } : {};

    let combined: any[] = [];

    // ── Payments ──────────────────────────────────────────────────────────────
    if (typeFilter === "all" || typeFilter === "payment") {
      const payments = await prisma.payment.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("paymentDate"),
          ...(destinationFilter ? { destination: destinationFilter } : {}),
          ...(shouldApplySearch && !isNumericLikeQuery
            ? {
                OR: [
                  { detail: { contains: query, mode: "insensitive" } },
                  { notes: { contains: query, mode: "insensitive" } },
                  { manualVoucherNo: { contains: query, mode: "insensitive" } },
                  { chequeNumber: { contains: query, mode: "insensitive" } },
                  { customer: { name: { contains: query, mode: "insensitive" } } },
                  { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
                  { city: { name: { contains: query, mode: "insensitive" } } },
                  { currency: { code: { contains: query, mode: "insensitive" } } },
                  { currency: { symbol: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
                  { superAdminBankAccount: { bankName: { contains: query, mode: "insensitive" } } },
                  { superAdminBankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
                  ...(paymentMethodQuery ? [{ paymentMethod: paymentMethodQuery as any }] : []),
                  ...(destinationQuery ? [{ destination: destinationQuery as any }] : []),
                  ...(paymentStatusQuery ? [{ status: paymentStatusQuery as any }] : []),
                  ...(hasNumericQuery
                    ? [
                        { amount: { gte: numericQuery, lt: numericQueryUpper } },
                        { usdEquivalent: { gte: numericQuery, lt: numericQueryUpper } },
                      ]
                    : []),
                ],
              }
            : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
          currency: { select: { id: true, code: true, symbol: true } },
          city: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        },
        orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
      } as any);
      const hajiAuditStateById = await getPaymentHajiAuditStateMap(payments.map((p) => p.id));
      combined.push(...(payments as any[]).map((p: any) => ({
        id: p.id,
        type: "payment",
        date: p.paymentDate.toISOString().split("T")[0],
        detail: p.detail,
        amount: Number(p.amount),
        currencySymbol: p.currency.symbol,
        currencyCode: p.currency.code,
        person: p.customer?.name ?? null,
        cityName: (p as any).city?.name ?? null,
        status: p.status,
        raw: {
          ...p,
          amount: Number(p.amount),
          exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
          usdEquivalent: p.usdEquivalent ? Number(p.usdEquivalent) : null,
          bankAccount: (p as any).bankAccount ?? null,
          bankAccountId: (p as any).bankAccountId ?? null,
          superAdminBankAccount: (p as any).superAdminBankAccount ?? null,
          superAdminBankAccountId: (p as any).superAdminBankAccountId ?? null,
          hajiAudit: isHajiAuditEligible(p) ? (hajiAuditStateById[p.id] || null) : null,
          attachments: (p as any).attachments ?? [],
        },
      })));
    }

    // ── Expenses ──────────────────────────────────────────────────────────────
    if ((typeFilter === "all" || typeFilter === "expense") && !(user.role === "super_admin" && destinationFilter === "haji")) {
      const expenses = await prisma.expense.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("expenseDate"),
          deletedAt: null,
          ...(shouldApplySearch && !isNumericLikeQuery
            ? {
                OR: [
                  { detail: { contains: query, mode: "insensitive" } },
                  { notes: { contains: query, mode: "insensitive" } },
                  { city: { name: { contains: query, mode: "insensitive" } } },
                  { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
                  { currency: { code: { contains: query, mode: "insensitive" } } },
                  { currency: { symbol: { contains: query, mode: "insensitive" } } },
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
        },
        orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
      });
      combined.push(...expenses.map((e) => ({
        id: e.id,
        type: "expense",
        date: e.expenseDate.toISOString().split("T")[0],
        detail: e.detail,
        amount: Number(e.amount),
        currencySymbol: e.currency.symbol,
        currencyCode: e.currency.code,
        person: null,
        status: null,
        raw: {
          ...e,
          amount: Number(e.amount),
          lotNumber: e.lot?.lotNumber ?? null,
          attachments: (e as any).attachments ?? [],
        },
      })));
    }

    // ── Haji Transfers ────────────────────────────────────────────────────────
    if ((typeFilter === "all" || typeFilter === "haji_transfer") && !(user.role === "super_admin" && destinationFilter === "haji")) {
      const hajis = await prisma.hajiTransfer.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("transferDate"),
          ...(shouldApplySearch && !isNumericLikeQuery
            ? {
                OR: [
                  { detail: { contains: query, mode: "insensitive" } },
                  { notes: { contains: query, mode: "insensitive" } },
                  { transferredTo: { contains: query, mode: "insensitive" } },
                  { city: { name: { contains: query, mode: "insensitive" } } },
                  { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
                  { currency: { code: { contains: query, mode: "insensitive" } } },
                  { currency: { symbol: { contains: query, mode: "insensitive" } } },
                  ...(transferTypeQuery ? [{ transferType: transferTypeQuery as any }] : []),
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
        },
        orderBy: [{ transferDate: "desc" }, { id: "desc" }],
      });
      combined.push(...hajis.map((h) => ({
        id: h.id,
        type: "haji_transfer",
        date: h.transferDate.toISOString().split("T")[0],
        detail: h.detail,
        amount: Number(h.amount),
        currencySymbol: h.currency.symbol,
        currencyCode: h.currency.code,
        person: h.transferredTo ?? null,
        status: null,
        raw: {
          ...h,
          amount: Number(h.amount),
          lotNumber: h.lot?.lotNumber ?? null,
          attachments: (h as any).attachments ?? [],
        },
      })));
    }

    // ── Personal Withdrawals ──────────────────────────────────────────────────
    if ((typeFilter === "all" || typeFilter === "withdrawal") && !(user.role === "super_admin" && destinationFilter === "haji")) {
      const withdrawals = await prisma.personalWithdrawal.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("withdrawalDate"),
          ...(shouldApplySearch && !isNumericLikeQuery
            ? {
                OR: [
                  { detail: { contains: query, mode: "insensitive" } },
                  { notes: { contains: query, mode: "insensitive" } },
                  { withdrawnBy: { contains: query, mode: "insensitive" } },
                  { city: { name: { contains: query, mode: "insensitive" } } },
                  { currency: { code: { contains: query, mode: "insensitive" } } },
                  { currency: { symbol: { contains: query, mode: "insensitive" } } },
                  ...(withdrawalStatusQuery === "approved" ? [{ approvedBy: { not: null } }] : []),
                  ...(withdrawalStatusQuery === "pending" ? [{ approvedBy: null }] : []),
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
        },
        orderBy: [{ withdrawalDate: "desc" }, { id: "desc" }],
      });
      combined.push(...withdrawals.map((w) => ({
        id: w.id,
        type: "withdrawal",
        date: w.withdrawalDate.toISOString().split("T")[0],
        detail: w.detail,
        amount: Number(w.amount),
        currencySymbol: w.currency.symbol,
        currencyCode: w.currency.code,
        person: w.withdrawnBy ?? null,
        status: w.approvedBy ? "approved" : "pending",
        raw: {
          ...w,
          amount: Number(w.amount),
        },
      })));
    }

    const openingCashRows = await prisma.openingCash.findMany({
      where: cityWhere,
      include: { currency: { select: { code: true } } },
    });
    const openingCashByCurrency: Record<string, number> = {};
    for (const row of openingCashRows) {
      const code = row.currency.code;
      openingCashByCurrency[code] = (openingCashByCurrency[code] || 0) + Number(row.amount || 0);
    }

    // Build running treasury balance in chronological order:
    // keep-in-office payments increase it, expenses/withdrawals/haji transfers reduce it.
    combined.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });

    const runningByCurrency: Record<string, number> = { ...openingCashByCurrency };
    combined = combined.map((item) => {
      const currencyCode = item.currencyCode || "";
      let delta = 0;
      if (item.type === "payment") {
        delta = item.raw?.destination === "our_account" ? Number(item.amount || 0) : 0;
      } else if (item.type === "expense" || item.type === "withdrawal" || item.type === "haji_transfer") {
        delta = -Number(item.amount || 0);
      }
      runningByCurrency[currencyCode] = (runningByCurrency[currencyCode] || 0) + delta;
      return {
        ...item,
        runningBalance: Math.round((runningByCurrency[currencyCode] || 0) * 100) / 100,
      };
    });

    if (shouldApplySearch) {
      const includesQuery = (value: unknown) => String(value ?? "").toLowerCase().includes(normalizedQuery);
      const inNumericWindow = (value: number) =>
        Number.isFinite(value) && value >= numericQuery && value < numericQueryUpper;
      const digitsOnly = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");
      const numericContains = (value: unknown) => queryDigits.length >= 2 && digitsOnly(value).includes(queryDigits);
      combined = combined.filter((item) => {
        const searchableFields = [
          item.date,
          item.type,
          item.person,
          item.detail,
          item.cityName,
          item.currencyCode,
          item.currencySymbol,
          item.raw?.manualVoucherNo,
          item.raw?.chequeNumber,
          item.raw?.paymentMethod,
          item.raw?.destination,
          item.raw?.status,
          item.status,
          item.raw?.chequeStatus,
          item.raw?.lotNumber,
          item.raw?.notes,
          item.raw?.transferType,
          item.raw?.transferredTo,
          item.raw?.withdrawnBy,
          item.raw?.bankAccount?.bankName,
          item.raw?.bankAccount?.accountNumber,
          item.raw?.superAdminBankAccount?.bankName,
          item.raw?.superAdminBankAccount?.accountNumber,
          item.raw?.hajiAudit?.confirmed ? "confirmed" : "",
        ];
        if (searchableFields.some(includesQuery)) return true;
        const numericFields = [
          Number(item.amount || 0),
          Number(item.runningBalance || 0),
          Number(item.raw?.usdEquivalent || 0),
        ];
        if (numericFields.some((value) => numericContains(value))) return true;
        if (hasNumericQuery) {
          return numericFields.some(inNumericWindow);
        }
        return false;
      });
    }

    const total = combined.length;
    const skip = (page - 1) * limit;
    const items = combined.slice(skip, skip + limit);

    return paginatedResponse(items, total, page, limit);
  } catch (error) {
    console.error("Finance combined error:", error);
    return serverError();
  }
});
