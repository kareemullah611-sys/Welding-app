import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const intermediary = await prisma.intermediary.findUnique({ where: { id } });
  if (!intermediary) return errorResponse("NOT_FOUND", "Not found", 404);

  const whereDeposits: any = { intermediaryId: id };
  const wherePayments: any = { intermediaryId: id };
  const whereExchanges: any = { intermediaryId: id, isActive: true };

  if (startDate || endDate) {
    if (startDate) {
      if (!whereDeposits.depositDate) whereDeposits.depositDate = {};
      whereDeposits.depositDate.gte = new Date(startDate);
      if (!wherePayments.paymentDate) wherePayments.paymentDate = {};
      wherePayments.paymentDate.gte = new Date(startDate);
      if (!whereExchanges.exchangeDate) whereExchanges.exchangeDate = {};
      whereExchanges.exchangeDate.gte = new Date(startDate);
    }
    if (endDate) {
      const eod = new Date(endDate);
      eod.setHours(23, 59, 59, 999);
      if (!whereDeposits.depositDate) whereDeposits.depositDate = {};
      whereDeposits.depositDate.lte = eod;
      if (!wherePayments.paymentDate) wherePayments.paymentDate = {};
      wherePayments.paymentDate.lte = eod;
      if (!whereExchanges.exchangeDate) whereExchanges.exchangeDate = {};
      whereExchanges.exchangeDate.lte = eod;
    }
  }

  const [totalDeposits, totalPayments, totalExchanges] = await Promise.all([
    prisma.intermediaryDeposit.count({ where: whereDeposits }),
    prisma.supplierPayment.count({ where: wherePayments }),
    prisma.intermediaryExchange.count({ where: whereExchanges }),
  ]);
  const totalEntries = totalDeposits + totalPayments + (totalExchanges * 2);
  const totalPages = Math.ceil(totalEntries / limit);
  const skip = (page - 1) * limit;

  const [deposits, payments, exchanges] = await Promise.all([
    prisma.intermediaryDeposit.findMany({
      where: whereDeposits,
      include: { currency: true, city: true, bankAccount: true, superAdminBankAccount: true, creator: { select: { fullName: true } } },
      orderBy: { depositDate: "asc" },
      skip,
      take: limit,
    }),
    prisma.supplierPayment.findMany({
      where: wherePayments,
      include: { supplier: true, creator: { select: { fullName: true } } },
      orderBy: { paymentDate: "asc" },
      skip,
      take: limit,
    }),
    prisma.intermediaryExchange.findMany({
      where: whereExchanges,
      include: {
        baseCurrency: true,
        quoteCurrency: true,
        fromCurrency: true,
        toCurrency: true,
        creator: { select: { fullName: true } },
      },
      orderBy: { exchangeDate: "asc" },
      skip,
      take: limit,
    }),
  ]);

  type LedgerEntry = {
    date: Date; type: "deposit" | "payment" | "exchange_out" | "exchange_in"; id: number;
    description: string; currencyCode: string; debit: number; credit: number;
    sourceType?: string;
    currencyId?: number;
    superAdminBankAccountId?: number | null;
    notes?: string | null;
  };

  const entries: LedgerEntry[] = [
    ...deposits.map((d) => ({
      date: d.depositDate, type: "deposit" as const, id: d.id,
      description: `Deposit${d.city ? ` (${d.city.name})` : ""}${d.bankAccount ? ` via ${d.bankAccount.bankName}` : ""}${d.superAdminBankAccount ? ` via ${d.superAdminBankAccount.bankName}` : ""}${d.notes ? ` — ${d.notes}` : ""}`,
      currencyCode: d.currency.code, debit: 0, credit: Number(d.amount),
      sourceType: d.sourceType,
      currencyId: d.currencyId,
      superAdminBankAccountId: d.superAdminBankAccountId,
      notes: d.notes,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate, type: "payment" as const, id: p.id,
      description: `Supplier payment — ${p.supplier.name}${p.notes ? ` — ${p.notes}` : ""}`,
      currencyCode: "USD", debit: Number(p.amountUsd), credit: 0,
    })),
    ...exchanges.flatMap((e) => ([
      {
        date: e.exchangeDate,
        type: "exchange_out" as const,
        id: e.id,
        description: `FX ${e.fromCurrency.code} → ${e.toCurrency.code} (1 ${(e.baseCurrency?.code || e.fromCurrency.code)} = ${Number(e.exchangeRate).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${(e.quoteCurrency?.code || e.toCurrency.code)})${e.notes ? ` — ${e.notes}` : ""}`,
        currencyCode: e.fromCurrency.code,
        debit: 0,
        credit: Number(e.fromAmount),
      },
      {
        date: e.exchangeDate,
        type: "exchange_in" as const,
        id: e.id,
        description: `FX ${e.fromCurrency.code} → ${e.toCurrency.code} (1 ${(e.baseCurrency?.code || e.fromCurrency.code)} = ${Number(e.exchangeRate).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${(e.quoteCurrency?.code || e.toCurrency.code)})${e.notes ? ` — ${e.notes}` : ""}`,
        currencyCode: e.toCurrency.code,
        debit: Number(e.toAmount),
        credit: 0,
      },
    ])),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const balances: Record<string, number> = {};
  const ledger = entries.map((e) => {
    balances[e.currencyCode] = (balances[e.currencyCode] || 0) + e.debit - e.credit;
    return { ...e, balance: balances[e.currencyCode] };
  });
  
  const paginatedLedger = ledger.slice(skip, skip + limit);

  const exchangeHistory = exchanges.map((e) => ({
    id: e.id,
    exchangeDate: e.exchangeDate,
    baseCurrencyId: e.baseCurrencyId ?? e.fromCurrencyId,
    baseCurrencyCode: e.baseCurrency?.code || e.fromCurrency.code,
    quoteCurrencyId: e.quoteCurrencyId ?? e.toCurrencyId,
    quoteCurrencyCode: e.quoteCurrency?.code || e.toCurrency.code,
    fromCurrencyId: e.fromCurrencyId,
    fromCurrencyCode: e.fromCurrency.code,
    fromAmount: Number(e.fromAmount),
    toCurrencyId: e.toCurrencyId,
    toCurrencyCode: e.toCurrency.code,
    toAmount: Number(e.toAmount),
    exchangeRate: Number(e.exchangeRate),
    notes: e.notes || null,
    createdByName: e.creator?.fullName || null,
  }));

  return successResponse({ intermediary, ledger: paginatedLedger, balances, exchangeHistory, pagination: { page, limit, totalPages, total: totalEntries } });
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const body = await request.json();

  const updated = await prisma.intermediary.update({
    where: { id },
    data: {
      name: body.name?.trim() || undefined,
      notes: body.notes !== undefined ? body.notes || null : undefined,
      isActive: body.isActive !== undefined ? body.isActive : undefined,
    },
  });
  return successResponse(updated, "Updated");
});
