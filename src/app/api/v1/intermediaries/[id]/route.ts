import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (_request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const intermediary = await prisma.intermediary.findUnique({ where: { id } });
  if (!intermediary) return errorResponse("NOT_FOUND", "Not found", 404);

  const [deposits, payments, exchanges] = await Promise.all([
    prisma.intermediaryDeposit.findMany({
      where: { intermediaryId: id },
      include: { currency: true, city: true, bankAccount: true, superAdminBankAccount: true, creator: { select: { fullName: true } } },
      orderBy: { depositDate: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: { intermediaryId: id },
      include: { supplier: true, creator: { select: { fullName: true } } },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.intermediaryExchange.findMany({
      where: { intermediaryId: id, isActive: true },
      include: {
        baseCurrency: true,
        quoteCurrency: true,
        fromCurrency: true,
        toCurrency: true,
        creator: { select: { fullName: true } },
      },
      orderBy: { exchangeDate: "asc" },
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

  return successResponse({ intermediary, ledger, balances, exchangeHistory });
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
