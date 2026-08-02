import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, paginatedResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getPaymentHajiAuditStateMap, isHajiAuditEligible } from "@/lib/payment-audit";
import { getSaCheckAuditStateMap } from "@/lib/sa-check-audit";
import { computeCityTreasuryNet, computeRunningBalances, computeSuperAdminRunningBalances, buildPaymentCancellationReversalRow } from "@/lib/treasury-ledger";
import { formatPaymentModuleDetail, formatSuperAdminPaymentDetail } from "@/lib/payment-module-detail";

function createdAtMs(item: any): number {
  const value = item.raw?.createdAt;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function compareCombinedPaymentsNewestFirst(a: any, b: any): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.type === "payment" && b.type === "haji_transfer" && b.raw?.paymentId === a.id) return 1;
  if (b.type === "payment" && a.type === "haji_transfer" && a.raw?.paymentId === b.id) return -1;
  const createdAtDiff = createdAtMs(b) - createdAtMs(a);
  if (createdAtDiff !== 0) return createdAtDiff;
  return b.id - a.id;
}

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1"));
    const limit = Math.max(1, Math.min(100, parseInt(sp.get("limit") || "20")));
    const typeFilter = sp.get("type") || "all";
    const destinationFilter = sp.get("destination");
    const paymentMethodFilter = sp.get("payment_method") as "cash" | "bank_transfer" | "cheque" | "online" | null;
    const chequeStatusFilter = sp.get("cheque_status") as "in_hand" | "deposited_to_bank" | "sent_to_haji" | "used_for_expense" | "used_for_liability" | "used_for_withdrawal" | "bounced" | null;
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
    const isSuperAdminHajiView = user.role === "super_admin" && destinationFilter === "haji";

    let combined: any[] = [];

    // ── Payments ──────────────────────────────────────────────────────────────
    if (typeFilter === "all" || typeFilter === "payment") {
      const payments = await prisma.payment.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("paymentDate"),
          ...(destinationFilter ? { destination: destinationFilter } : {}),
          ...(paymentMethodFilter ? { paymentMethod: paymentMethodFilter } : {}),
          ...(chequeStatusFilter ? { chequeStatus: chequeStatusFilter } : {}),
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
          city: { select: { id: true, name: true, country: { select: { name: true } } } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          hajiTransferPayment: {
            select: {
              id: true,
              settlementDestination: true,
              intermediaryId: true,
              superAdminCashAccountId: true,
              transferredTo: true,
              detail: true,
              referenceNo: true,
            },
          },
        },
        orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
      } as any);
      const hajiAuditStateById = await getPaymentHajiAuditStateMap(payments.map((p) => p.id));
      const saCheckStateById = await getSaCheckAuditStateMap("payments", payments.map((p) => p.id));
      for (const p of payments as any[]) {
        combined.push({
          id: p.id,
          type: "payment",
          date: p.paymentDate.toISOString().split("T")[0],
          detail: (p as any).city?.country?.name === "Afghanistan"
            ? p.detail
            : isSuperAdminHajiView && p.destination === "haji"
            ? formatSuperAdminPaymentDetail({
                paymentMethod: p.paymentMethod,
                superAdminBankAccount: (p as any).superAdminBankAccount,
              })
            : formatPaymentModuleDetail({
            paymentMethod: p.paymentMethod,
            destination: p.destination,
            manualVoucherNo: p.manualVoucherNo,
            chequeNumber: (p as any).chequeNumber,
            bankAccount: (p as any).bankAccount,
            superAdminBankAccount: (p as any).superAdminBankAccount,
          }),
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
            saCheck: saCheckStateById[p.id] || null,
            attachments: (p as any).attachments ?? [],
          },
        });
        const reversal = buildPaymentCancellationReversalRow(p);
        if (reversal) combined.push(reversal);
      }
    }

    // ── Expenses ──────────────────────────────────────────────────────────────
    if ((typeFilter === "all" || typeFilter === "expense") && !isSuperAdminHajiView) {
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
                  { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { manualVoucherNo: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { chequeNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { customer: { name: { contains: query, mode: "insensitive" } } } },
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          chequePayment: {
            select: {
              id: true,
              amount: true,
              manualVoucherNo: true,
              chequeNumber: true,
              chequeStatus: true,
              customer: { select: { id: true, name: true } },
              currency: { select: { id: true, code: true, symbol: true } },
            },
          },
        },
        orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
      });
      const saCheckStateById = await getSaCheckAuditStateMap("expenses", expenses.map((e) => e.id));
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
          bankAccount: (e as any).bankAccount ?? null,
          bankAccountId: (e as any).bankAccountId ?? null,
          chequePayment: (e as any).chequePayment ?? null,
          saCheck: saCheckStateById[e.id] || null,
          attachments: (e as any).attachments ?? [],
        },
      })));
    }

    // ── Haji Transfers ────────────────────────────────────────────────────────
    if (typeFilter === "all" || typeFilter === "haji_transfer" || isSuperAdminHajiView) {
      const hajis = await prisma.hajiTransfer.findMany({
        where: {
          ...cityWhere,
          ...dateWhere("transferDate"),
          ...(shouldApplySearch && !isNumericLikeQuery
            ? {
                OR: [
                  { detail: { contains: query, mode: "insensitive" } },
                  { notes: { contains: query, mode: "insensitive" } },
                  { referenceNo: { contains: query, mode: "insensitive" } },
                  { transferredTo: { contains: query, mode: "insensitive" } },
                  { city: { name: { contains: query, mode: "insensitive" } } },
                  { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
                  { currency: { code: { contains: query, mode: "insensitive" } } },
                  { currency: { symbol: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { manualVoucherNo: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { chequeNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { customer: { name: { contains: query, mode: "insensitive" } } } },
                  { payment: { manualVoucherNo: { contains: query, mode: "insensitive" } } },
                  { payment: { chequeNumber: { contains: query, mode: "insensitive" } } },
                  { payment: { customer: { name: { contains: query, mode: "insensitive" } } } },
                  ...(transferTypeQuery ? [{ transferType: transferTypeQuery as any }] : []),
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
          city: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          chequePayment: {
            select: {
              id: true,
              amount: true,
              manualVoucherNo: true,
              chequeNumber: true,
              chequeStatus: true,
              customer: { select: { id: true, name: true } },
              currency: { select: { id: true, code: true, symbol: true } },
            },
          },
          payment: {
            select: {
              id: true,
              manualVoucherNo: true,
              chequeNumber: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ transferDate: "desc" }, { id: "desc" }],
      });
      const saCheckStateById = await getSaCheckAuditStateMap("haji_transfers", hajis.map((h) => h.id));
      combined.push(...hajis.map((h) => ({
        id: h.id,
        type: "haji_transfer",
        date: h.transferDate.toISOString().split("T")[0],
        detail: h.detail,
        amount: Number(h.amount),
        currencySymbol: h.currency.symbol,
        currencyCode: h.currency.code,
        person: h.transferredTo ?? null,
        cityName: h.city?.name ?? null,
        status: null,
        raw: {
          ...h,
          amount: Number(h.amount),
          lotNumber: h.lot?.lotNumber ?? null,
          referenceNo: h.referenceNo ?? null,
          bankAccount: (h as any).bankAccount ?? null,
          bankAccountId: (h as any).bankAccountId ?? null,
          saCheck: saCheckStateById[h.id] || null,
          attachments: (h as any).attachments ?? [],
        },
      })));
    }

    // ── Personal Withdrawals ──────────────────────────────────────────────────
    if ((typeFilter === "all" || typeFilter === "withdrawal") && !isSuperAdminHajiView) {
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
                  { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
                  { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { manualVoucherNo: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { chequeNumber: { contains: query, mode: "insensitive" } } },
                  { chequePayment: { customer: { name: { contains: query, mode: "insensitive" } } } },
                  ...(withdrawalStatusQuery === "approved" ? [{ approvedBy: { not: null } }] : []),
                  ...(withdrawalStatusQuery === "pending" ? [{ approvedBy: null }] : []),
                  ...(hasNumericQuery ? [{ amount: { gte: numericQuery, lt: numericQueryUpper } }] : []),
                ],
              }
            : {}),
        },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          chequePayment: {
            select: {
              id: true,
              amount: true,
              manualVoucherNo: true,
              chequeNumber: true,
              chequeStatus: true,
              customer: { select: { id: true, name: true } },
              currency: { select: { id: true, code: true, symbol: true } },
            },
          },
        },
        orderBy: [{ withdrawalDate: "desc" }, { id: "desc" }],
      });
      const saCheckStateById = await getSaCheckAuditStateMap("personal_withdrawals", withdrawals.map((w) => w.id));
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
          bankAccount: (w as any).bankAccount ?? null,
          bankAccountId: (w as any).bankAccountId ?? null,
          chequePayment: (w as any).chequePayment ?? null,
          saCheck: saCheckStateById[w.id] || null,
        },
      })));
    }

    if (typeFilter === "all" && !isSuperAdminHajiView) {
      const openingCashRows = await prisma.openingCash.findMany({
        where: cityWhere,
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          city: { select: { id: true, name: true } },
        },
        orderBy: [{ openingDate: "desc" }, { id: "desc" }],
      });
      combined.push(...openingCashRows.map((row) => ({
        id: row.id,
        type: "opening_cash",
        date: row.openingDate.toISOString().split("T")[0],
        detail: "Opening cash",
        amount: Number(row.amount),
        currencySymbol: row.currency.symbol,
        currencyCode: row.currency.code,
        person: null,
        cityName: row.city?.name ?? null,
        status: null,
        raw: {
          ...row,
          amount: Number(row.amount),
          sourceType: "opening_cash",
        },
      })));

      const openingBankRows = await prisma.openingBankBalance.findMany({
        where: cityId ? { bankAccount: { cityId } } : {},
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true, city: { select: { id: true, name: true } } } },
        },
        orderBy: [{ openingDate: "desc" }, { id: "desc" }],
      });
      combined.push(...openingBankRows.map((row) => ({
        id: row.id,
        type: "opening_bank",
        date: row.openingDate.toISOString().split("T")[0],
        detail: `Opening bank — ${row.bankAccount.bankName}`,
        amount: Number(row.amount),
        currencySymbol: row.currency.symbol,
        currencyCode: row.currency.code,
        person: row.bankAccount.accountNumber ?? null,
        cityName: row.bankAccount.city?.name ?? null,
        status: null,
        raw: {
          ...row,
          amount: Number(row.amount),
          bankAccount: row.bankAccount,
          bankAccountId: row.bankAccountId,
          sourceType: "opening_bank",
        },
      })));
    }

    const openingCashRows = await prisma.openingCash.findMany({
      where: cityWhere,
      include: { currency: { select: { code: true } } },
    });
    const openingBankRows = await prisma.openingBankBalance.findMany({
      where: cityId ? { bankAccount: { cityId } } : {},
      include: { currency: { select: { code: true } } },
    });
    const openingCashByCurrency: Record<string, number> = {};
    for (const row of openingCashRows) {
      const code = row.currency.code;
      openingCashByCurrency[code] = (openingCashByCurrency[code] || 0) + Number(row.amount || 0);
    }
    for (const row of openingBankRows) {
      const code = row.currency.code;
      openingCashByCurrency[code] = (openingCashByCurrency[code] || 0) + Number(row.amount || 0);
    }

    const { itemsWithBalance } = isSuperAdminHajiView
      ? computeSuperAdminRunningBalances(combined)
      : computeRunningBalances(combined, openingCashByCurrency);
    const balanceById = new Map(itemsWithBalance.map((item) => [`${item.type}:${item.id}`, item.runningBalance]));
    combined = combined.map((item) => ({
      ...item,
      runningBalance: balanceById.get(`${item.type}:${item.id}`) ?? 0,
    }));

    combined.sort(compareCombinedPaymentsNewestFirst);

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
          item.raw?.referenceNo,
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
          item.raw?.paidFrom,
          item.raw?.sourceType,
          item.raw?.bankAccount?.bankName,
          item.raw?.bankAccount?.accountNumber,
          item.raw?.superAdminBankAccount?.bankName,
          item.raw?.superAdminBankAccount?.accountNumber,
          item.raw?.chequePayment?.manualVoucherNo,
          item.raw?.chequePayment?.chequeNumber,
          item.raw?.chequePayment?.chequeStatus,
          item.raw?.chequePayment?.customer?.name,
          item.raw?.payment?.manualVoucherNo,
          item.raw?.payment?.chequeNumber,
          item.raw?.payment?.customer?.name,
          item.raw?.hajiAudit?.confirmed ? "confirmed" : "",
          item.raw?.saCheck?.confirmed ? "verified" : "",
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

    const currentBalanceByCurrency =
      cityId != null ? await computeCityTreasuryNet(prisma, cityId) : {};

    return paginatedResponse(items, total, page, limit, undefined, {
      currentBalanceByCurrency,
    });
  } catch (error) {
    console.error("Finance combined error:", error);
    return serverError();
  }
});
