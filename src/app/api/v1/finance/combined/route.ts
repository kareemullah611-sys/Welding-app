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
    const fromDate = sp.get("from_date");
    const toDate = sp.get("to_date");

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
        where: { ...cityWhere, ...dateWhere("paymentDate") },
        include: {
          customer: { select: { id: true, name: true } },
          currency: { select: { id: true, code: true, symbol: true } },
          city: { select: { id: true, name: true } },
        },
        orderBy: { paymentDate: "desc" },
      });
      const hajiAuditStateById = await getPaymentHajiAuditStateMap(payments.map((p) => p.id));
      combined.push(...payments.map((p) => ({
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
          hajiAudit: isHajiAuditEligible(p) ? (hajiAuditStateById[p.id] || null) : null,
          attachments: (p as any).attachments ?? [],
        },
      })));
    }

    // ── Expenses ──────────────────────────────────────────────────────────────
    if (typeFilter === "all" || typeFilter === "expense") {
      const expenses = await prisma.expense.findMany({
        where: { ...cityWhere, ...dateWhere("expenseDate"), deletedAt: null },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
        },
        orderBy: { expenseDate: "desc" },
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
    if (typeFilter === "all" || typeFilter === "haji_transfer") {
      const hajis = await prisma.hajiTransfer.findMany({
        where: { ...cityWhere, ...dateWhere("transferDate") },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          lot: { select: { id: true, lotNumber: true } },
        },
        orderBy: { transferDate: "desc" },
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
    if (typeFilter === "all" || typeFilter === "withdrawal") {
      const withdrawals = await prisma.personalWithdrawal.findMany({
        where: { ...cityWhere, ...dateWhere("withdrawalDate") },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
        },
        orderBy: { withdrawalDate: "desc" },
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

    // Build running treasury balance in chronological order:
    // keep-in-office payments increase it, expenses/withdrawals/haji transfers reduce it.
    combined.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });

    const runningByCurrency: Record<string, number> = {};
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

    // Return newest first for display
    combined.reverse();

    const total = combined.length;
    const skip = (page - 1) * limit;
    const items = combined.slice(skip, skip + limit);

    return paginatedResponse(items, total, page, limit);
  } catch (error) {
    console.error("Finance combined error:", error);
    return serverError();
  }
});
