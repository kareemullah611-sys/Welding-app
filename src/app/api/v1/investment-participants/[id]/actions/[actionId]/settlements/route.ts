import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { withAuth } from "@/lib/middleware";
import {
  calculateSettlementStatus,
  round2,
  validateSettlementAllocation,
} from "@/lib/investor-participant-actions";
import {
  normalizeExchangeRateRow,
  selectRateForPosition,
} from "@/lib/exchange-rate-provider";
import {
  isInvestorFxSettlementEnabled,
  isInvestorSettlementEnabled,
} from "@/lib/investor-production-gate";

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

function requireSuperAdmin(user: JWTPayload) {
  return user.role === "super_admin";
}

async function resolvePkrEquivalent(input: {
  tx: any;
  currencyId: number;
  settlementAmount: number;
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
      pkrEquivalent: input.settlementAmount,
      exchangeRate: null,
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
        providerReference: "manual-settlement-input",
        entryMethod: "manual",
      }),
      "liability"
    );
    if (!normalized.ok) throw new Error("MISSING_FX_RATE");
    const computed = round2(input.settlementAmount * normalized.rate);
    enforceExpectedEquivalent(computed);
    return {
      currency,
      pkrEquivalent: computed,
      exchangeRate: normalized.rate,
      rateSource: normalized.market,
      rateDate,
      selectedRateType: normalized.selectedRateType,
      providerReference: normalized.providerReference,
      conversionPath: normalized.conversionPath,
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
  const computed = round2(input.settlementAmount * normalized.rate);
  enforceExpectedEquivalent(computed);

  return {
    currency,
    pkrEquivalent: computed,
    exchangeRate: normalized.rate,
    rateSource: normalized.market,
    rateDate,
    selectedRateType: normalized.selectedRateType,
    providerReference: normalized.providerReference,
    conversionPath: normalized.conversionPath,
  };
}

async function refreshActionSettlement(tx: any, actionId: number) {
  const action = await tx.investmentParticipantAction.findUnique({
    where: { id: actionId },
    include: { settlements: true },
  });
  if (!action) throw new Error("ACTION_NOT_FOUND");
  const status = calculateSettlementStatus(Number(action.totalAmountPkr || 0), action.settlements);
  if (!status.ok) throw new Error("SETTLEMENT_RECONCILIATION_FAILED");
  await tx.investmentParticipantAction.update({
    where: { id: actionId },
    data: {
      settledAmountPkr: status.settledAmountPkr,
      remainingSettlementPkr: status.remainingAmountPkr,
      settlementStatus: status.status,
    },
  });
  return status;
}

export const GET = withAuth(async (_request: NextRequest, context: any, user: JWTPayload) => {
  if (!requireSuperAdmin(user)) return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const actionId = parseInt(context.params.actionId, 10);
    if (!participantId || !actionId) return errorResponse("VALIDATION", "Participant and action are required", 400);

    const action = await (prisma as any).investmentParticipantAction.findFirst({
      where: { id: actionId, participantId },
      include: {
        settlements: { include: { currency: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      },
    });
    if (!action) return errorResponse("NOT_FOUND", "Investor action not found", 404);
    const settlementStatus = calculateSettlementStatus(Number(action.totalAmountPkr || 0), action.settlements);
    return successResponse({
      actionId,
      obligationPkr: Number(action.totalAmountPkr || 0),
      settledAmountPkr: settlementStatus.settledAmountPkr,
      remainingSettlementPkr: settlementStatus.remainingAmountPkr,
      settlementStatus: settlementStatus.status,
      reconciliationDifferencePkr: round2(Number(action.totalAmountPkr || 0) - settlementStatus.settledAmountPkr - settlementStatus.remainingAmountPkr),
      settlements: action.settlements.map((settlement: any) => ({
        id: settlement.id,
        status: settlement.status,
        currencyCode: settlement.currency?.code,
        settlementAmount: Number(settlement.settlementAmount),
        pkrEquivalent: Number(settlement.pkrEquivalent),
        profitComponentPkr: Number(settlement.profitComponentPkr || 0),
        capitalComponentPkr: Number(settlement.capitalComponentPkr || 0),
        exchangeRate: settlement.exchangeRate == null ? null : Number(settlement.exchangeRate),
        rateSource: settlement.rateSource,
        selectedRateType: settlement.selectedRateType,
        conversionPath: settlement.conversionPathJson || [],
        paymentDate: settlement.paymentDate.toISOString().slice(0, 10),
        paymentReference: settlement.paymentReference,
        paymentMethod: settlement.paymentMethod,
        bankCashAccount: settlement.bankCashAccount,
        reversalOfSettlementId: settlement.reversalOfSettlementId,
        reversalReason: settlement.reversalReason,
      })),
    });
  } catch (error) {
    console.error("Investor settlement list error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (!requireSuperAdmin(user)) return errorResponse("FORBIDDEN", "Super admin only", 403);
  if (!isInvestorSettlementEnabled()) return errorResponse("FEATURE_DISABLED", "Investor settlement execution is disabled until production enablement is approved.", 403);
  try {
    const participantId = parseInt(context.params.id, 10);
    const actionId = parseInt(context.params.actionId, 10);
    const body = await request.json();
    const action = String(body.action || "create");
    const idempotencyKey = String(body.idempotencyKey || body.paymentReference || "").trim();
    if (!participantId || !actionId) return errorResponse("VALIDATION", "Participant and action are required", 400);
    if (!idempotencyKey) return errorResponse("VALIDATION", "Unique settlement reference/idempotency key is required", 400);
    if (String(body.confirmation || "") !== "CONFIRM") return errorResponse("VALIDATION", "Explicit CONFIRM confirmation is required", 400);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`investment-participant-settlement:${actionId}`}::text)::bigint)`;

      const duplicate = await (tx as any).investmentParticipantSettlement.findUnique({ where: { idempotencyKey } });
      if (duplicate) {
        if (Number(duplicate.actionId) !== actionId || Number(duplicate.participantId) !== participantId) throw new Error("DUPLICATE_SETTLEMENT_REFERENCE");
        return { duplicate: true, settlement: duplicate, status: await refreshActionSettlement(tx, actionId) };
      }

      const investorAction = await (tx as any).investmentParticipantAction.findFirst({
        where: { id: actionId, participantId },
        include: { settlements: true },
      });
      if (!investorAction) throw new Error("ACTION_NOT_FOUND");

      if (action === "reverse") {
        const settlementId = Number(body.settlementId || 0);
        const reason = String(body.reversalReason || body.remarks || "").trim();
        if (!settlementId) throw new Error("SETTLEMENT_REQUIRED");
        if (!reason) throw new Error("REVERSAL_REASON_REQUIRED");
        const original = await (tx as any).investmentParticipantSettlement.findFirst({
          where: { id: settlementId, actionId, participantId, status: { not: "reversed" } },
        });
        if (!original) throw new Error("SETTLEMENT_NOT_FOUND");
        await (tx as any).investmentParticipantSettlement.update({ where: { id: original.id }, data: { status: "reversed" } });
        const reversal = await (tx as any).investmentParticipantSettlement.create({
          data: {
            actionId,
            participantId,
            status: "reversed",
            currencyId: original.currencyId,
            settlementAmount: -Number(original.settlementAmount),
            pkrEquivalent: -Number(original.pkrEquivalent),
            profitComponentPkr: -Number(original.profitComponentPkr || 0),
            capitalComponentPkr: -Number(original.capitalComponentPkr || 0),
            exchangeRate: original.exchangeRate,
            rateSource: original.rateSource,
            rateDate: original.rateDate,
            selectedRateType: original.selectedRateType,
            providerReference: original.providerReference,
            conversionPathJson: original.conversionPathJson,
            paymentDate: original.paymentDate,
            paymentReference: String(body.paymentReference || `${original.paymentReference}-REV`).trim(),
            paymentMethod: original.paymentMethod,
            bankCashAccount: original.bankCashAccount,
            idempotencyKey,
            reversalOfSettlementId: original.id,
            reversalReason: reason,
            createdBy: user.userId,
          },
        });
        return { settlement: reversal, status: await refreshActionSettlement(tx, actionId) };
      }

      if (!["profit_withdrawal", "capital_withdrawal", "mixed_withdrawal", "full_exit"].includes(String(investorAction.actionType))) {
        throw new Error("ACTION_NOT_SETTLEABLE");
      }
      if (investorAction.status !== "active") throw new Error("ACTION_NOT_ACTIVE");
      if (Number(investorAction.remainingSettlementPkr || 0) <= 0 || investorAction.settlementStatus === "settled") throw new Error("ACTION_ALREADY_SETTLED");

      const paymentDate = parseDate(body.paymentDate);
      const currencyId = Number(body.currencyId || 0);
      const settlementAmount = parseAmount(body.settlementAmount);
      const paymentReference = String(body.paymentReference || idempotencyKey).trim();
      const paymentMethod = String(body.paymentMethod || "").trim();
      if (!paymentDate) throw new Error("PAYMENT_DATE_REQUIRED");
      if (!currencyId) throw new Error("CURRENCY_REQUIRED");
      if (settlementAmount <= 0) throw new Error("SETTLEMENT_AMOUNT_REQUIRED");
      if (!paymentReference) throw new Error("PAYMENT_REFERENCE_REQUIRED");
      if (!paymentMethod) throw new Error("PAYMENT_METHOD_REQUIRED");

      const fx = await resolvePkrEquivalent({
        tx,
        currencyId,
        settlementAmount,
        paymentDate,
        exchangeRate: parseAmount(body.exchangeRate),
        rateSource: String(body.rateSource || "manual_open_market").trim(),
        expectedPkrEquivalent: parseOptionalAmount(body.expectedPkrEquivalent ?? body.pkrEquivalent),
      });
      const pkrEquivalent = fx.pkrEquivalent;
      const profitComponentPkr = ["mixed_withdrawal", "full_exit"].includes(String(investorAction.actionType))
        ? parseAmount(body.profitComponentPkr)
        : String(investorAction.actionType) === "profit_withdrawal"
          ? pkrEquivalent
          : 0;
      const capitalComponentPkr = ["mixed_withdrawal", "full_exit"].includes(String(investorAction.actionType))
        ? parseAmount(body.capitalComponentPkr)
        : ["capital_withdrawal", "full_exit"].includes(String(investorAction.actionType))
          ? pkrEquivalent
          : 0;
      const allocationError = validateSettlementAllocation({
        actionType: investorAction.actionType,
        settlementPkrEquivalent: pkrEquivalent,
        profitComponentPkr,
        capitalComponentPkr,
      });
      if (allocationError) throw new Error(`VALIDATION:${allocationError}`);

      const activeSettlements = investorAction.settlements.filter((settlement: any) => settlement.status !== "reversed");
      const existingProfitSettled = round2(activeSettlements.reduce((sum: number, settlement: any) => sum + Number(settlement.profitComponentPkr || 0), 0));
      const existingCapitalSettled = round2(activeSettlements.reduce((sum: number, settlement: any) => sum + Number(settlement.capitalComponentPkr || 0), 0));
      if (round2(existingProfitSettled + profitComponentPkr) > Number(investorAction.profitAmountPkr || 0)) throw new Error("PROFIT_COMPONENT_OVER_SETTLED");
      if (round2(existingCapitalSettled + capitalComponentPkr) > Number(investorAction.capitalAmountPkr || 0)) throw new Error("CAPITAL_COMPONENT_OVER_SETTLED");

      const nextStatus = calculateSettlementStatus(Number(investorAction.totalAmountPkr || 0), [
        ...activeSettlements,
        { pkrEquivalent, status: "settled", idempotencyKey },
      ]);
      if (!nextStatus.ok) throw new Error("OVER_SETTLEMENT");

      const settlement = await (tx as any).investmentParticipantSettlement.create({
        data: {
          actionId,
          participantId,
          status: "settled",
          currencyId,
          settlementAmount,
          pkrEquivalent,
          profitComponentPkr,
          capitalComponentPkr,
          exchangeRate: fx.exchangeRate,
          rateSource: fx.rateSource,
          rateDate: fx.rateDate,
          selectedRateType: fx.selectedRateType,
          providerReference: fx.providerReference,
          conversionPathJson: fx.conversionPath,
          paymentDate,
          paymentReference,
          paymentMethod,
          bankCashAccount: String(body.bankCashAccount || "").trim() || null,
          idempotencyKey,
          createdBy: user.userId,
        },
      });

      await (tx as any).investmentParticipantAction.update({
        where: { id: actionId },
        data: {
          settledAmountPkr: nextStatus.settledAmountPkr,
          remainingSettlementPkr: nextStatus.remainingAmountPkr,
          settlementStatus: nextStatus.status,
        },
      });
      return { settlement, status: nextStatus };
    });

    return successResponse(result, result.duplicate ? "Duplicate settlement reference reused" : "Investor settlement recorded", result.duplicate ? 200 : 201);
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message === "ACTION_NOT_FOUND") return errorResponse("NOT_FOUND", "Investor action not found", 404);
    if (message === "DUPLICATE_SETTLEMENT_REFERENCE") return errorResponse("DUPLICATE", "Settlement reference is already used by another action", 409);
    if (message === "ACTION_NOT_SETTLEABLE") return errorResponse("VALIDATION", "This investor action does not require settlement", 400);
    if (message === "ACTION_NOT_ACTIVE") return errorResponse("VALIDATION", "Cannot settle a reversed/cancelled investor action", 400);
    if (message === "ACTION_ALREADY_SETTLED") return errorResponse("VALIDATION", "Investor action is already fully settled", 400);
    if (message === "CURRENCY_NOT_FOUND") return errorResponse("VALIDATION", "Settlement currency not found", 400);
    if (message === "PKR_CURRENCY_NOT_FOUND") return errorResponse("VALIDATION", "PKR currency is required for settlement valuation", 400);
    if (message === "MISSING_FX_RATE") return errorResponse("VALIDATION", "Missing required settlement FX rate for the selected currency/date", 400);
    if (message === "FX_SETTLEMENT_DISABLED") return errorResponse("FEATURE_DISABLED", "Foreign-currency investor settlement is disabled until FX gain/loss policy is approved.", 403);
    if (message === "FX_PKR_EQUIVALENT_REQUIRED") return errorResponse("VALIDATION", "Foreign-currency settlement requires an explicit expected PKR equivalent.", 400);
    if (message === "FX_PKR_EQUIVALENT_MISMATCH") return errorResponse("VALIDATION", "Foreign-currency settlement PKR equivalent does not match the approved rate calculation.", 400);
    if (message === "PAYMENT_DATE_REQUIRED") return errorResponse("VALIDATION", "Payment date is required", 400);
    if (message === "CURRENCY_REQUIRED") return errorResponse("VALIDATION", "Settlement currency is required", 400);
    if (message === "SETTLEMENT_AMOUNT_REQUIRED") return errorResponse("VALIDATION", "Settlement amount must be greater than 0", 400);
    if (message === "PAYMENT_REFERENCE_REQUIRED") return errorResponse("VALIDATION", "Payment reference is required", 400);
    if (message === "PAYMENT_METHOD_REQUIRED") return errorResponse("VALIDATION", "Payment method is required", 400);
    if (message === "OVER_SETTLEMENT") return errorResponse("VALIDATION", "Settlement exceeds remaining investor action obligation", 400);
    if (message === "PROFIT_COMPONENT_OVER_SETTLED") return errorResponse("VALIDATION", "Profit component settlement exceeds action profit obligation", 400);
    if (message === "CAPITAL_COMPONENT_OVER_SETTLED") return errorResponse("VALIDATION", "Capital component settlement exceeds action capital obligation", 400);
    if (message === "SETTLEMENT_REQUIRED") return errorResponse("VALIDATION", "Settlement is required for reversal", 400);
    if (message === "REVERSAL_REASON_REQUIRED") return errorResponse("VALIDATION", "Reversal reason is required", 400);
    if (message === "SETTLEMENT_NOT_FOUND") return errorResponse("VALIDATION", "Active settlement was not found", 400);
    if (message === "SETTLEMENT_RECONCILIATION_FAILED") return errorResponse("VALIDATION", "Settlement reconciliation failed", 400);
    if (message.startsWith("VALIDATION:")) return errorResponse("VALIDATION", message.replace("VALIDATION:", ""), 400);
    console.error("Investor settlement create error:", error);
    return serverError();
  }
});
