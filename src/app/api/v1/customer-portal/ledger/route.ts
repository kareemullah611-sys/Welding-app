import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import { getCustomerPortalCustomer } from "@/lib/customer-portal-auth";
import {
  formatCustomerLedgerPaymentDetail,
  formatCustomerLedgerSaleItemDetail,
  formatCustomerLedgerSaleItemRate,
} from "@/lib/customer-ledger-detail";
import { buildDateRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const customer = await getCustomerPortalCustomer(request);
    if (!customer) return errorResponse("UNAUTHORIZED", "Please login", 401);

    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const ledgerType = (searchParams.get("ledger_type") || "all").trim().toLowerCase();

    const saleDateFilter = buildDateRange(dateFrom, dateTo);
    const paymentDateFilter = buildDateRange(dateFrom, dateTo);

    const [sales, payments, openings] = await Promise.all([
      prisma.sale.findMany({
        where: {
          customerId: customer.id,
          isOpeningImport: false,
          ...(Object.keys(saleDateFilter).length ? { saleDate: saleDateFilter } : {}),
        },
        include: { currency: true, items: { include: { product: true, lot: { select: { lotNumber: true } } } }, lot: { select: { lotNumber: true } } },
        orderBy: { saleDate: "asc" },
      }),
      prisma.payment.findMany({
        where: { customerId: customer.id, ...(Object.keys(paymentDateFilter).length ? { paymentDate: paymentDateFilter } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.openingCustomerBalance.findMany({
        where: { customerId: customer.id, ...(Object.keys(saleDateFilter).length ? { openingDate: saleDateFilter } : {}) },
        include: { currency: true },
        orderBy: { openingDate: "asc" },
      }),
    ]);

    const transactions = [
      ...openings.map((o) => ({
        type: "opening" as const,
        date: o.openingDate.toISOString().split("T")[0],
        voucherNo: "OPEN",
        detail: "Opening customer balance",
        perCartonPrice: "-",
        debit: Number(o.amount),
        credit: 0,
        status: "active",
        currency: o.currency.code,
        currencySymbol: o.currency.symbol || o.currency.code,
        lotNumber: "-",
      })),
      ...sales.flatMap((s) => (s.items || []).map((item) => ({
        type: "sale" as const,
        date: s.saleDate.toISOString().split("T")[0],
        voucherNo: s.voucherNo,
        detail: formatCustomerLedgerSaleItemDetail(item),
        perCartonPrice: formatCustomerLedgerSaleItemRate(item),
        debit: ["active", "marked_short"].includes(s.status) ? Number(item.amount) : 0,
        credit: 0,
        status: s.status,
        currency: s.currency.code,
        currencySymbol: s.currency.symbol || s.currency.code,
        lotNumber: item.lot?.lotNumber || s.lot.lotNumber,
      }))),
      ...payments.map((p) => {
        const amount = p.status === "active" ? Number(p.amount) : 0;
        return {
          type: "payment" as const,
          date: p.paymentDate.toISOString().split("T")[0],
          voucherNo: p.manualVoucherNo || "-",
          detail: amount < 0 ? `Returned — ${formatCustomerLedgerPaymentDetail(p)}` : formatCustomerLedgerPaymentDetail(p),
          perCartonPrice: "-",
          debit: amount < 0 ? Math.abs(amount) : 0,
          credit: amount > 0 ? amount : 0,
          status: p.status,
          currency: p.currency.code,
          currencySymbol: p.currency.symbol || p.currency.code,
          lotNumber: p.lot.lotNumber,
        };
      }),
    ].filter((t) => ledgerType === "all" || t.type === ledgerType)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const runningByCurrency: Record<string, number> = {};
    const ledger = transactions.map((t) => {
      const curr = t.currency;
      runningByCurrency[curr] = (runningByCurrency[curr] || 0) + t.debit - t.credit;
      return { ...t, balance: Math.round(runningByCurrency[curr] * 100) / 100 };
    });

    const balanceByCurrency: Record<string, number> = {};
    for (const [cc, amt] of Object.entries(runningByCurrency)) {
      balanceByCurrency[cc] = Math.round(amt * 100) / 100;
    }

    return successResponse({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      city: customer.city.name,
      country: customer.city.country.name,
      balanceByCurrency,
      ledger: [...ledger].reverse(),
    });
  } catch (error) {
    console.error("Customer portal ledger error:", error);
    return serverError();
  }
}
