import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { withAuth } from "@/lib/middleware";
import {
  createJournalEntries,
  getInvestorSettlementPayableAccountId,
  getSuperAdminBankGLAccountId,
  getSuperAdminCashGLAccountId,
  reverseJournalEntries,
} from "@/lib/accounting";
import {
  normalizeExchangeRateRow,
  selectRateForPosition,
} from "@/lib/exchange-rate-provider";
import { round2 } from "@/lib/investor-participant-actions";
import {
  isInvestorFxSettlementEnabled,
  isInvestorSettlementEnabled,
} from "@/lib/investor-production-gate";
import { resolveAfghanistanFxRateFromDb } from "@/lib/sarafi-af-snapshot-db";

function parseDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? round2(amount) : 0;
}

function parseOptionalAmount(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? round2(amount) : null;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function activePaymentTotal(payments: any[]) {
  return round2(payments.filter((payment) => payment.status !== "reversed").reduce((sum, payment) => sum + Number(payment.pkrEquivalent || 0), 0));
}

async function resolvePkrEquivalent(input: {
  tx: any;
  currencyId: number;
  paymentAmount: number;
  paymentDate: Date;
  exchangeRate?: number;
  rateSource?: string | null;
  expectedPkrEquivalent?: number | null;
}) {
  const currency = await input.tx.currency.findUnique({ where: { id: input.currencyId } });
  if (!currency) throw new Error("CURRENCY_NOT_FOUND");
  const code = String(currency.code || "").toUpperCase();
  if (code === "PKR") {
    return {
      currency,
      pkrEquivalent: input.paymentAmount,
      exchangeRate: null,
      fxSnapshotId: null,
      rateSource: "manual_open_market",
      rateDate: null,
      selectedRateType: null,
      providerReference: null,
      conversionPath: ["PKR→PKR"],
    };
  }

  if (!isInvestorFxSettlementEnabled()) throw new Error("FX_SETTLEMENT_DISABLED");
  const pkr = await input.tx.currency.findUnique({ where: { code: "PKR" } });
  if (!pkr) throw new Error("PKR_CURRENCY_NOT_FOUND");
  const rateDate = dateOnly(input.paymentDate);
  const source = String(input.rateSource || "manual_open_market").trim();
  const enforceExpectedEquivalent = (computed: number) => {
    if (input.expectedPkrEquivalent == null || input.expectedPkrEquivalent <= 0) throw new Error("FX_PKR_EQUIVALENT_REQUIRED");
    if (round2(input.expectedPkrEquivalent) !== computed) throw new Error("FX_PKR_EQUIVALENT_MISMATCH");
  };
  if (input.exchangeRate && input.exchangeRate > 0) {
    const normalized = selectRateForPosition(
      normalizeExchangeRateRow({
        provider: "MANUAL_OPEN_MARKET",
        market: source,
        fromCurrencyCode: code,
        toCurrencyCode: "PKR",
        sellRate: input.exchangeRate,
        sourceTimestamp: rateDate,
        fetchedTimestamp: new Date(),
        providerReference: "manual-settlement-payment-input",
        entryMethod: "manual",
      }),
      "liability"
    );
    if (!normalized.ok) throw new Error("MISSING_FX_RATE");
    const computed = round2(input.paymentAmount * normalized.rate);
    enforceExpectedEquivalent(computed);
    return {
      currency,
      pkrEquivalent: computed,
      exchangeRate: normalized.rate,
      fxSnapshotId: null,
      rateSource: normalized.market,
      rateDate,
      selectedRateType: normalized.selectedRateType,
      providerReference: normalized.providerReference,
      conversionPath: normalized.conversionPath,
    };
  }

  const sarafi = await resolveAfghanistanFxRateFromDb({
    tx: input.tx,
    currencyCode: code,
    transactionDate: input.paymentDate,
    purpose: "settlement",
    positionKind: "liability",
  });
  if (sarafi.ok && sarafi.provider === "SARAFI_AF") {
    const computed = round2(input.paymentAmount * sarafi.rate);
    enforceExpectedEquivalent(computed);
    return {
      currency,
      pkrEquivalent: computed,
      exchangeRate: sarafi.rate,
      fxSnapshotId: sarafi.snapshotId || null,
      rateSource: sarafi.market,
      rateDate,
      selectedRateType: sarafi.selectedRateType,
      providerReference: sarafi.providerReference,
      conversionPath: sarafi.conversionPath,
    };
  }

  const rate = await input.tx.exchangeRate.findFirst({
    where: {
      rateDate,
      fromCurrencyId: input.currencyId,
      toCurrencyId: pkr.id,
      source,
    },
    orderBy: { id: "desc" },
  });
  if (!rate) throw new Error("MISSING_FX_RATE");
  const normalized = selectRateForPosition(
    normalizeExchangeRateRow({
      provider: "MANUAL_OPEN_MARKET",
      market: rate.source,
      fromCurrencyCode: code,
      toCurrencyCode: "PKR",
      buyRate: rate.buyRate == null ? null : Number(rate.buyRate),
      sellRate: rate.sellRate == null ? null : Number(rate.sellRate),
      referenceRate: Number(rate.referenceRate),
      sourceTimestamp: rate.rateDate,
      fetchedTimestamp: rate.createdAt,
      providerReference: `exchange_rates:${rate.id}`,
      entryMethod: rate.entryMethod === "api" ? "api" : "manual",
    }),
    "liability"
  );
  if (!normalized.ok) throw new Error("MISSING_FX_RATE");
  const computed = round2(input.paymentAmount * normalized.rate);
  enforceExpectedEquivalent(computed);
  return {
    currency,
    pkrEquivalent: computed,
    exchangeRate: normalized.rate,
    fxSnapshotId: null,
    rateSource: normalized.market,
    rateDate,
    selectedRateType: normalized.selectedRateType,
    providerReference: normalized.providerReference,
    conversionPath: normalized.conversionPath,
  };
}

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  if (!isInvestorSettlementEnabled()) return errorResponse("FEATURE_DISABLED", "Investor settlement payment execution is disabled until production enablement is approved.", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const actionId = parseInt(context.params.actionId, 10);
    const settlementId = parseInt(context.params.settlementId, 10);
    const body = await request.json();
    const operation = String(body.action || "create");
    const idempotencyKey = String(body.idempotencyKey || body.paymentReference || "").trim();
    if (!participantId || !actionId || !settlementId) return errorResponse("VALIDATION", "Participant, action, and settlement are required", 400);
    if (!idempotencyKey) return errorResponse("VALIDATION", "Unique payment idempotency/reference is required", 400);
    if (String(body.confirmation || "") !== "CONFIRM") return errorResponse("VALIDATION", "Explicit CONFIRM confirmation is required", 400);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`investment-settlement-payment:${settlementId}`}::text)::bigint)`;

      const duplicate = await (tx as any).investmentParticipantSettlementPayment.findUnique({ where: { idempotencyKey } });
      if (duplicate) {
        if (Number(duplicate.settlementId) !== settlementId) throw new Error("DUPLICATE_PAYMENT_REFERENCE");
        return { duplicate: true, payment: duplicate };
      }

      const settlement = await (tx as any).investmentParticipantSettlement.findFirst({
        where: { id: settlementId, actionId, participantId, status: { not: "reversed" } },
        include: { payments: true, participant: true, currency: true },
      });
      if (!settlement) throw new Error("SETTLEMENT_NOT_FOUND");

      if (operation === "reverse") {
        const paymentId = Number(body.paymentId || 0);
        const reason = String(body.reversalReason || body.remarks || "").trim();
        if (!paymentId) throw new Error("PAYMENT_REQUIRED");
        if (!reason) throw new Error("REVERSAL_REASON_REQUIRED");
        const original = await (tx as any).investmentParticipantSettlementPayment.findFirst({
          where: { id: paymentId, settlementId, status: { not: "reversed" } },
        });
        if (!original) throw new Error("PAYMENT_NOT_FOUND");
        await (tx as any).investmentParticipantSettlementPayment.update({ where: { id: original.id }, data: { status: "reversed" } });
        if (original.journalTransactionId) await reverseJournalEntries(original.journalTransactionId, user.userId, tx);
        const reversal = await (tx as any).investmentParticipantSettlementPayment.create({
          data: {
            settlementId,
            actionId,
            participantId,
            status: "reversed",
            superAdminBankAccountId: original.superAdminBankAccountId,
            currencyId: original.currencyId,
            paymentAmount: -Number(original.paymentAmount),
            pkrEquivalent: -Number(original.pkrEquivalent),
            exchangeRate: original.exchangeRate,
            rateSource: original.rateSource,
            rateDate: original.rateDate,
            selectedRateType: original.selectedRateType,
            providerReference: original.providerReference,
            conversionPathJson: original.conversionPathJson,
            paymentDate: original.paymentDate,
            paymentReference: String(body.paymentReference || `${original.paymentReference}-REV`).trim(),
            paymentMethod: original.paymentMethod,
            remarks: reason,
            idempotencyKey,
            journalTransactionId: original.journalTransactionId ? `REV-${original.journalTransactionId}` : null,
            reversalOfPaymentId: original.id,
            reversalReason: reason,
            createdBy: user.userId,
          },
        });
        return { payment: reversal };
      }

      const paymentDate = parseDate(body.paymentDate);
      const paymentAmount = parseAmount(body.paymentAmount);
      const accountId = Number(body.superAdminBankAccountId || 0);
      const currencyId = Number(body.currencyId || 0);
      const paymentReference = String(body.paymentReference || idempotencyKey).trim();
      const paymentMethod = String(body.paymentMethod || "").trim();
      if (!paymentDate) throw new Error("PAYMENT_DATE_REQUIRED");
      if (paymentAmount <= 0) throw new Error("PAYMENT_AMOUNT_REQUIRED");
      if (!accountId) throw new Error("ACCOUNT_REQUIRED");
      if (!currencyId) throw new Error("CURRENCY_REQUIRED");
      if (!paymentReference) throw new Error("PAYMENT_REFERENCE_REQUIRED");
      if (!paymentMethod) throw new Error("PAYMENT_METHOD_REQUIRED");

      const account = await tx.superAdminBankAccount.findFirst({ where: { id: accountId, isActive: true }, include: { currency: true } });
      if (!account) throw new Error("ACCOUNT_NOT_FOUND");
      if (Number(account.currencyId) !== currencyId) throw new Error("ACCOUNT_CURRENCY_MISMATCH");

      const fx = await resolvePkrEquivalent({
        tx,
        currencyId,
        paymentAmount,
        paymentDate,
        exchangeRate: parseAmount(body.exchangeRate),
        rateSource: String(body.rateSource || "manual_open_market").trim(),
        expectedPkrEquivalent: parseOptionalAmount(body.expectedPkrEquivalent ?? body.pkrEquivalent),
      });
      const paidAlready = activePaymentTotal(settlement.payments);
      const remaining = round2(Number(settlement.pkrEquivalent || 0) - paidAlready);
      if (fx.pkrEquivalent > remaining) throw new Error("OVER_PAYMENT");

      const journalTransactionId = `INVSETTLE-PAY-${idempotencyKey}`.slice(0, 80);
      const payment = await (tx as any).investmentParticipantSettlementPayment.create({
        data: {
          settlementId,
          actionId,
          participantId,
          status: "settled",
          superAdminBankAccountId: accountId,
          currencyId,
          paymentAmount,
          pkrEquivalent: fx.pkrEquivalent,
          exchangeRate: fx.exchangeRate,
          fxSnapshotId: fx.fxSnapshotId || null,
          rateSource: fx.rateSource,
          rateDate: fx.rateDate,
          selectedRateType: fx.selectedRateType,
          providerReference: fx.providerReference,
          conversionPathJson: fx.conversionPath,
          paymentDate,
          paymentReference,
          paymentMethod,
          remarks: String(body.remarks || "").trim() || null,
          idempotencyKey,
          journalTransactionId,
          createdBy: user.userId,
        },
      });

      const payableAccountId = await getInvestorSettlementPayableAccountId(tx);
      const assetAccountId = account.accountKind === "cash"
        ? await getSuperAdminCashGLAccountId(account.id, tx)
        : await getSuperAdminBankGLAccountId(account.id, tx);
      await createJournalEntries(journalTransactionId, [
        { accountId: payableAccountId, debit: fx.pkrEquivalent, credit: 0, description: `Investor settlement paid — ${settlement.participant.name}` },
        { accountId: assetAccountId, debit: 0, credit: fx.pkrEquivalent, description: `Investor settlement paid from ${account.bankName}` },
      ], {
        currencyCode: "PKR",
        exchangeRate: fx.exchangeRate || undefined,
        entityType: "investment_participant_settlement_payment",
        entityId: payment.id,
        entryDate: paymentDate,
        createdBy: user.userId,
      }, tx);

      return { payment, remainingUnpaidPkr: round2(remaining - fx.pkrEquivalent) };
    });

    return successResponse(result, result.duplicate ? "Duplicate settlement payment reference reused" : "Investor settlement payment recorded", result.duplicate ? 200 : 201);
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message === "DUPLICATE_PAYMENT_REFERENCE") return errorResponse("DUPLICATE", "Settlement payment reference is already used elsewhere", 409);
    if (message === "SETTLEMENT_NOT_FOUND") return errorResponse("NOT_FOUND", "Settlement not found", 404);
    if (message === "PAYMENT_REQUIRED") return errorResponse("VALIDATION", "Payment is required for reversal", 400);
    if (message === "REVERSAL_REASON_REQUIRED") return errorResponse("VALIDATION", "Reversal reason is required", 400);
    if (message === "PAYMENT_NOT_FOUND") return errorResponse("VALIDATION", "Active settlement payment was not found", 400);
    if (message === "PAYMENT_DATE_REQUIRED") return errorResponse("VALIDATION", "Payment date is required", 400);
    if (message === "PAYMENT_AMOUNT_REQUIRED") return errorResponse("VALIDATION", "Payment amount must be greater than 0", 400);
    if (message === "ACCOUNT_REQUIRED") return errorResponse("VALIDATION", "Bank/cash account is required", 400);
    if (message === "CURRENCY_REQUIRED") return errorResponse("VALIDATION", "Currency is required", 400);
    if (message === "PAYMENT_REFERENCE_REQUIRED") return errorResponse("VALIDATION", "Payment reference is required", 400);
    if (message === "PAYMENT_METHOD_REQUIRED") return errorResponse("VALIDATION", "Payment method is required", 400);
    if (message === "ACCOUNT_NOT_FOUND") return errorResponse("VALIDATION", "Selected superadmin bank/cash account not found", 400);
    if (message === "ACCOUNT_CURRENCY_MISMATCH") return errorResponse("VALIDATION", "Selected account currency must match payment currency", 400);
    if (message === "CURRENCY_NOT_FOUND") return errorResponse("VALIDATION", "Currency not found", 400);
    if (message === "PKR_CURRENCY_NOT_FOUND") return errorResponse("VALIDATION", "PKR currency is required for settlement payment valuation", 400);
    if (message === "MISSING_FX_RATE") return errorResponse("VALIDATION", "Missing required settlement payment FX rate", 400);
    if (message === "FX_SETTLEMENT_DISABLED") return errorResponse("FEATURE_DISABLED", "Foreign-currency investor settlement payment is disabled until FX gain/loss policy is approved.", 403);
    if (message === "FX_PKR_EQUIVALENT_REQUIRED") return errorResponse("VALIDATION", "Foreign-currency settlement payment requires an explicit expected PKR equivalent.", 400);
    if (message === "FX_PKR_EQUIVALENT_MISMATCH") return errorResponse("VALIDATION", "Foreign-currency settlement payment PKR equivalent does not match the approved rate calculation.", 400);
    if (message === "OVER_PAYMENT") return errorResponse("VALIDATION", "Settlement payment exceeds remaining unpaid settlement amount", 400);
    console.error("Investor settlement payment error:", error);
    return serverError();
  }
});
