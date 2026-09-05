import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildIntermediaryLedgerEntries, paginateIntermediaryLedger } from "@/lib/intermediary-ledger";
import { buildDateRange } from "@/lib/date-range";

function applyDateRange(
  target: Record<string, unknown>,
  field: string,
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate && !endDate) return;
  target[field] = buildDateRange(startDate, endDate);
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

  const whereDeposits: Record<string, unknown> = { intermediaryId: id, deletedAt: null };
  const whereOpenings: Record<string, unknown> = { intermediaryId: id };
  const wherePayments: Record<string, unknown> = { intermediaryId: id, deletedAt: null };
  const whereShippingPayments: Record<string, unknown> = { intermediaryId: id, deletedAt: null };
  const whereAgentPayments: Record<string, unknown> = { intermediaryId: id, deletedAt: null };
  const whereLiabilityEntries: Record<string, unknown> = { intermediaryId: id };
  const whereExchanges: Record<string, unknown> = { intermediaryId: id, isActive: true };
  const whereHajiTransfers: Record<string, unknown> = { intermediaryId: id, settlementDestination: "intermediary" };
  const whereHajiCashReceipts: Record<string, unknown> = { intermediaryId: id, reversedAt: null };

  applyDateRange(whereDeposits, "depositDate", startDate, endDate);
  applyDateRange(whereOpenings, "openingDate", startDate, endDate);
  applyDateRange(wherePayments, "paymentDate", startDate, endDate);
  applyDateRange(whereShippingPayments, "paymentDate", startDate, endDate);
  applyDateRange(whereAgentPayments, "paymentDate", startDate, endDate);
  applyDateRange(whereLiabilityEntries, "entryDate", startDate, endDate);
  applyDateRange(whereExchanges, "exchangeDate", startDate, endDate);
  applyDateRange(whereHajiTransfers, "transferDate", startDate, endDate);
  applyDateRange(whereHajiCashReceipts, "receiptDate", startDate, endDate);

  const [openingLiabilities, deposits, payments, shippingPayments, agentPayments, liabilityEntries, exchanges, hajiTransfers, hajiCashReceipts] = await Promise.all([
    prisma.openingLiability.findMany({
      where: whereOpenings,
      include: { currency: { select: { code: true } } },
      orderBy: { openingDate: "asc" },
    }),
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
    prisma.shippingLinePayment.findMany({
      where: whereShippingPayments,
      include: { shippingLine: { select: { name: true } } },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.agentPayment.findMany({
      where: whereAgentPayments,
      include: { agent: { select: { name: true } } },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.superAdminLiabilityEntry.findMany({
      where: whereLiabilityEntries,
      include: { currency: { select: { code: true } }, account: { select: { name: true } } },
      orderBy: { entryDate: "asc" },
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

  const entries = buildIntermediaryLedgerEntries({ openingLiabilities, deposits, payments, shippingPayments, agentPayments, liabilityEntries, exchanges, hajiTransfers, hajiCashReceipts });
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
