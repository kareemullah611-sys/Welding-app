import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { formatCustomerLedgerPaymentDetail } from "@/lib/customer-ledger-detail";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const ledgerType = (searchParams.get("ledger_type") || "all").trim().toLowerCase();
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { city: { include: { country: true } } },
    });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);
    if (user.role === "city_admin" && customer.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const saleDateFilter: any = {};
    if (dateFrom) saleDateFilter.gte = new Date(dateFrom);
    if (dateTo) saleDateFilter.lte = new Date(dateTo);
    const paymentDateFilter: any = {};
    if (dateFrom) paymentDateFilter.gte = new Date(dateFrom);
    if (dateTo) paymentDateFilter.lte = new Date(dateTo);

    // Get ledger
    const [sales, payments, openings] = await Promise.all([
      prisma.sale.findMany({
        where: {
          customerId: id,
          isOpeningImport: false,
          ...(Object.keys(saleDateFilter).length ? { saleDate: saleDateFilter } : {}),
        },
        include: { currency: true, items: { include: { product: true } }, lot: { select: { lotNumber: true } } },
        orderBy: { saleDate: "asc" },
      }),
      prisma.payment.findMany({
        where: { customerId: id, ...(Object.keys(paymentDateFilter).length ? { paymentDate: paymentDateFilter } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.openingCustomerBalance.findMany({
        where: { customerId: id, ...(Object.keys(saleDateFilter).length ? { openingDate: saleDateFilter } : {}) },
        include: { currency: true },
        orderBy: { openingDate: "asc" },
      }),
    ]);

    const formatPerCartonRate = (rates: number[]) => {
      if (!rates.length) return "-";
      const uniqueRates = Array.from(new Set(rates.map((value) => Math.round(value * 100) / 100))).sort((a, b) => a - b);
      if (uniqueRates.length === 1) return uniqueRates[0].toLocaleString("en-US");
      const min = uniqueRates[0].toLocaleString("en-US");
      const max = uniqueRates[uniqueRates.length - 1].toLocaleString("en-US");
      return `${min} - ${max}`;
    };

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
      ...sales.map((s) => ({
        type: "sale" as const,
        date: s.saleDate.toISOString().split("T")[0],
        voucherNo: s.voucherNo,
        detail: (s.items || []).map((i) => `${i.product.name} × ${Number(i.qty)}`).join(", "),
        perCartonPrice: formatPerCartonRate((s.items || []).map((i) => Number(i.ratePerCarton)).filter((value) => !Number.isNaN(value))),
        debit: ["active", "marked_short"].includes(s.status) ? Number(s.totalAmount) : 0,
        credit: 0,
        status: s.status,
        currency: s.currency.code,
        currencySymbol: s.currency.symbol || s.currency.code,
        lotNumber: s.lot.lotNumber,
      })),
      ...payments.map((p) => ({
        type: "payment" as const,
        date: p.paymentDate.toISOString().split("T")[0],
        voucherNo: p.manualVoucherNo || "-",
        detail: formatCustomerLedgerPaymentDetail(p),
        perCartonPrice: "-",
        debit: 0,
        credit: p.status === "active" ? Number(p.amount) : 0,
        status: p.status,
        currency: p.currency.code,
        currencySymbol: p.currency.symbol || p.currency.code,
        lotNumber: p.lot.lotNumber,
      })),
    ].filter((t) => ledgerType === "all" || t.type === ledgerType)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Track running balance separately per currency to avoid mixing USD and AFN
    const runningByCurrency: Record<string, number> = {};
    const ledger = transactions.map((t) => {
      const curr = t.currency;
      runningByCurrency[curr] = (runningByCurrency[curr] || 0) + t.debit - t.credit;
      return { ...t, balance: Math.round(runningByCurrency[curr] * 100) / 100 };
    });

    // Summary balance per currency
    const balanceByCurrency: Record<string, number> = {};
    for (const [cc, amt] of Object.entries(runningByCurrency)) {
      balanceByCurrency[cc] = Math.round(amt * 100) / 100;
    }
    // Legacy scalar balance (sum across currencies — for backward compat)
    const balance = Object.values(runningByCurrency).reduce((s, v) => s + v, 0);

    return successResponse({
      id: customer.id, name: customer.name, phone: customer.phone, address: customer.address,
      isActive: customer.isActive, city: customer.city.name, country: customer.city.country.name, countryCode: customer.city.country.code,
      balance, balanceByCurrency, ledger: [...ledger].reverse(),
    });
  } catch (error) {
    return serverError();
  }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);
    if (user.role === "city_admin" && customer.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const updated = await prisma.customer.update({
      where: { id },
      data: { name: body.name || customer.name, phone: body.phone !== undefined ? body.phone : customer.phone, address: body.address !== undefined ? body.address : customer.address, isActive: body.isActive !== undefined ? body.isActive : customer.isActive, updatedAt: new Date() },
    });

    await createAuditLog(user.userId, customer.cityId, "customers", id, "update", { name: customer.name }, { name: updated.name }, getClientIP(request));
    return successResponse({ id: updated.id, name: updated.name }, "Customer updated");
  } catch (error) {
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);
    if (user.role === "city_admin" && customer.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    // Soft delete
    await prisma.customer.update({ where: { id }, data: { isActive: false, updatedAt: new Date() } });
    await createAuditLog(user.userId, customer.cityId, "customers", id, "delete", undefined, undefined, getClientIP(request));
    return successResponse({ id }, "Customer deactivated");
  } catch (error) {
    return serverError();
  }
});
