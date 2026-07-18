import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildIntermediaryLedgerEntries, paginateIntermediaryLedger } from "@/lib/intermediary-ledger";

function applyDateRange(
  target: Record<string, unknown>,
  field: string,
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate && !endDate) return;
  const range: Record<string, Date> = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) {
    const eod = new Date(endDate);
    eod.setHours(23, 59, 59, 999);
    range.lte = eod;
  }
  target[field] = range;
}

export const GET = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const intermediary = await prisma.intermediary.findUnique({ where: { id } });
  if (!intermediary) return errorResponse("NOT_FOUND", "Not found", 404);

  const whereDeposits: Record<string, unknown> = { intermediaryId: id };
  const wherePayments: Record<string, unknown> = { intermediaryId: id };
  const whereExchanges: Record<string, unknown> = { intermediaryId: id, isActive: true };
  const whereHajiTransfers: Record<string, unknown> = { intermediaryId: id, settlementDestination: "intermediary" };
  const whereHajiCashReceipts: Record<string, unknown> = { intermediaryId: id };

  applyDateRange(whereDeposits, "depositDate", startDate, endDate);
  applyDateRange(wherePayments, "paymentDate", startDate, endDate);
  applyDateRange(whereExchanges, "exchangeDate", startDate, endDate);
  applyDateRange(whereHajiTransfers, "transferDate", startDate, endDate);
  applyDateRange(whereHajiCashReceipts, "receiptDate", startDate, endDate);

  const [deposits, payments, exchanges, hajiTransfers, hajiCashReceipts] = await Promise.all([
    prisma.intermediaryDeposit.findMany({
      where: whereDeposits,
      include: { currency: true, city: true, bankAccount: true, superAdminBankAccount: true, creator: { select: { fullName: true } } },
      orderBy: { depositDate: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: wherePayments,
      include: { supplier: true, creator: { select: { fullName: true } } },
      orderBy: { paymentDate: "asc" },
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
    }),
    prisma.hajiTransfer.findMany({
      where: whereHajiTransfers,
      include: {
        currency: true,
        city: true,
      },
      orderBy: { transferDate: "asc" },
    }),
    prisma.hajiCashReceipt.findMany({
      where: whereHajiCashReceipts,
      include: {
        currency: true,
        superAdminCashAccount: { select: { bankName: true } },
      },
      orderBy: { receiptDate: "asc" },
    }),
  ]);

  const entries = buildIntermediaryLedgerEntries({ deposits, payments, exchanges, hajiTransfers, hajiCashReceipts });
  const { ledger, balances, pagination } = paginateIntermediaryLedger(entries, page, limit);

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

  return successResponse({ intermediary, ledger, balances, exchangeHistory, pagination });
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
