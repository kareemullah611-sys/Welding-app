import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { updateCustomerSchema } from "@/lib/validations";
import {
  formatCustomerLedgerPaymentDetail,
  formatCustomerLedgerSaleItemDetail,
  formatCustomerLedgerSaleItemRate,
} from "@/lib/customer-ledger-detail";
import { buildDateRange } from "@/lib/date-range";

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

    const saleDateFilter = buildDateRange(dateFrom, dateTo);
    const paymentDateFilter = buildDateRange(dateFrom, dateTo);

    // Get ledger
    const [sales, payments, openings] = await Promise.all([
      prisma.sale.findMany({
        where: {
          customerId: id,
          isOpeningImport: false,
          ...(Object.keys(saleDateFilter).length ? { saleDate: saleDateFilter } : {}),
        },
        include: { currency: true, items: { include: { product: true, lot: { select: { lotNumber: true } } } }, lot: { select: { lotNumber: true } } },
        orderBy: { saleDate: "asc" },
      }),
      prisma.payment.findMany({
        where: { customerId: id, ...(Object.keys(paymentDateFilter).length ? { paymentDate: paymentDateFilter } : {}) },
        include: {
          currency: true,
          lot: { select: { lotNumber: true } },
          bankAccount: { select: { bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { bankName: true, accountNumber: true } },
          customerPaidExpense: { select: { id: true } },
        },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.openingCustomerBalance.findMany({
        where: { customerId: id, ...(Object.keys(saleDateFilter).length ? { openingDate: saleDateFilter } : {}) },
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
          detail: (p as any).customerPaidExpense
            ? "cash- expense"
            : amount < 0 ? `Returned — ${formatCustomerLedgerPaymentDetail(p)}` : formatCustomerLedgerPaymentDetail(p),
          perCartonPrice: "-",
          debit: amount < 0 ? Math.abs(amount) : 0,
          credit: amount > 0 ? amount : 0,
          status: p.status,
          currency: p.currency.code,
          currencySymbol: p.currency.symbol || p.currency.code,
          lotNumber: p.lot?.lotNumber ?? null,
        };
      }),
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
      portalAccessEnabled: customer.portalAccessEnabled,
      portalUsername: customer.portalUsername,
      portalLastLoginAt: customer.portalLastLoginAt,
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
    const parsed = updateCustomerSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid customer data", 400, parsed.error.errors);
    const data = parsed.data;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);
    if (user.role === "city_admin" && customer.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const nextPortalAccessEnabled = data.portalAccessEnabled !== undefined ? data.portalAccessEnabled : customer.portalAccessEnabled;
    const nextPortalUsername = data.portalUsername !== undefined
      ? data.portalUsername?.trim().toLowerCase() || null
      : customer.portalUsername;
    if (nextPortalAccessEnabled) {
      if (!nextPortalUsername) return errorResponse("VALIDATION_ERROR", "Portal username is required");
      if (!data.portalPassword && !customer.portalPasswordHash) {
        return errorResponse("VALIDATION_ERROR", "Portal password is required when enabling portal access");
      }
      const duplicate = await prisma.customer.findFirst({
        where: { portalUsername: nextPortalUsername, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) return errorResponse("CONFLICT", "Portal username already exists", 409);
    }
    const nextPortalPasswordHash = data.portalPassword
      ? await hashPassword(data.portalPassword)
      : customer.portalPasswordHash;

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        name: data.name || customer.name,
        phone: data.phone !== undefined ? data.phone : customer.phone,
        address: data.address !== undefined ? data.address : customer.address,
        isActive: data.isActive !== undefined ? data.isActive : customer.isActive,
        portalAccessEnabled: nextPortalAccessEnabled,
        portalUsername: nextPortalAccessEnabled ? nextPortalUsername : null,
        portalPasswordHash: nextPortalAccessEnabled ? nextPortalPasswordHash : null,
        updatedAt: new Date(),
      },
    });

    await createAuditLog(user.userId, customer.cityId, "customers", id, "update", { name: customer.name }, { name: updated.name }, getClientIP(request));
    return successResponse({
      id: updated.id,
      name: updated.name,
      portalAccessEnabled: updated.portalAccessEnabled,
      portalUsername: updated.portalUsername,
      portalLastLoginAt: updated.portalLastLoginAt,
    }, "Customer updated");
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
