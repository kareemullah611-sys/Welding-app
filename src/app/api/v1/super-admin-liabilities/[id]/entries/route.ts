import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalSuperAdminLiabilityEntry } from "@/lib/accounting";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import { calculateLiabilitySettlementFx, SuperAdminLiabilitySettlementError } from "@/lib/superadmin-liability-accounting";

const round2 = (value: number) => Math.round(value * 100) / 100;

export const GET = withSuperAdmin(async (_request: NextRequest, context: any) => {
  try {
    const accountId = Number(context.params.id);
    const account = await prisma.superAdminLiabilityAccount.findUnique({
      where: { id: accountId },
      include: {
        entries: {
          include: {
            currency: { select: { code: true } },
            superAdminBankAccount: { select: { bankName: true } },
            superAdminCashAccount: { select: { bankName: true } },
            intermediary: { select: { name: true } },
            bankAccount: { select: { bankName: true } },
            city: { select: { name: true } },
          },
          orderBy: [{ entryDate: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!account) return errorResponse("NOT_FOUND", "Liability account not found", 404);
    const balancesByCurrency: Record<string, number> = {};
    let balancePkr = 0;
    const entries = account.entries.map((entry) => {
      const code = entry.currency.code;
      balancesByCurrency[code] = round2((balancesByCurrency[code] || 0) + Number(entry.liabilityEffect));
      balancePkr = round2(balancePkr + Number(entry.pkrLiabilityEffect));
      return {
        ...entry,
        amount: Number(entry.amount),
        liabilityEffect: Number(entry.liabilityEffect),
        exchangeRateToPkr: Number(entry.exchangeRateToPkr),
        pkrAmount: Number(entry.pkrAmount),
        pkrLiabilityEffect: Number(entry.pkrLiabilityEffect),
        carryingRatePkr: entry.carryingRatePkr == null ? null : Number(entry.carryingRatePkr),
        carryingAmountPkr: entry.carryingAmountPkr == null ? null : Number(entry.carryingAmountPkr),
        realizedFxPkr: entry.realizedFxPkr == null ? null : Number(entry.realizedFxPkr),
        runningBalance: balancesByCurrency[code],
        runningBalancePkr: balancePkr,
      };
    });
    return successResponse({ account: { id: account.id, name: account.name, partyType: account.partyType }, entries, balancesByCurrency, balancePkr });
  } catch (error) {
    console.error("Read superadmin liability ledger:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const accountId = Number(context.params.id);
    const body = await request.json();
    const entryType = String(body.entryType || "");
    if (!new Set(["loan_received", "liability_incurred", "payment"]).has(entryType)) return validationError("Invalid liability entry type");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");
    const currencyId = Number(body.currencyId);
    const [account, currency] = await Promise.all([
      prisma.superAdminLiabilityAccount.findUnique({ where: { id: accountId }, include: { controlAccount: true } }),
      prisma.currency.findUnique({ where: { id: currencyId } }),
    ]);
    if (!account || !account.isActive) return errorResponse("NOT_FOUND", "Active liability account not found", 404);
    if (!currency) return validationError("Currency is required");
    if (entryType === "loan_received" && account.partyType !== "lender") return validationError("Loan receipts are allowed only for lender accounts");
    if (entryType === "liability_incurred" && account.partyType !== "creditor") return validationError("Liability charges are allowed only for creditor accounts");

    const currencyCode = String(currency.code).toUpperCase();
    const exchangeRateToPkr = currencyCode === "PKR" ? 1 : Number(body.exchangeRateToPkr);
    if (!Number.isFinite(exchangeRateToPkr) || exchangeRateToPkr <= 0) return validationError(`${currencyCode} → PKR rate is required`);
    const rateSource = currencyCode === "PKR" ? "PKR" : String(body.rateSource || "").trim();
    if (!rateSource) return validationError("Exchange-rate source is required");
    const pkrAmount = round2(amount * exchangeRateToPkr);
    let source: Awaited<ReturnType<typeof validatePaymentSource>> | null = null;
    let sourceType: string | null = null;

    if (entryType !== "liability_incurred") {
      sourceType = String(body.sourceType || "");
      const allowed = account.partyType === "lender"
        ? new Set(["super_admin_bank", "super_admin_cash", "intermediary"])
        : new Set(["super_admin_bank", "super_admin_cash", "intermediary", "city_bank", "city_cash"]);
      if (!allowed.has(sourceType)) return validationError("Selected source is not permitted for this liability");
      source = await validatePaymentSource({
        bankAccountId: sourceType === "city_bank" ? body.bankAccountId : null,
        superAdminBankAccountId: sourceType === "super_admin_bank" ? body.superAdminBankAccountId : null,
        superAdminCashAccountId: sourceType === "super_admin_cash" ? body.superAdminCashAccountId : null,
        intermediaryId: sourceType === "intermediary" ? body.intermediaryId : null,
        cityId: body.cityId ? Number(body.cityId) : null,
        currencyCode,
        requireSelection: sourceType !== "city_cash",
      });
      if (!source.ok) return errorResponse(source.code, source.message, source.status);
      if (sourceType === "city_cash" && !Number(body.cityId)) return validationError("City is required for a city-cash payment");
    }

    let counterAccountId: number | null = null;
    if (entryType === "liability_incurred") {
      counterAccountId = Number(body.counterAccountId || 0);
      const counter = counterAccountId ? await prisma.account.findUnique({ where: { id: counterAccountId } }) : null;
      if (!counter || !counter.isActive || !new Set(["asset", "expense", "cogs"]).has(counter.accountType)) {
        return validationError("Select an active asset, expense, or COGS counterpart account");
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `superadmin-liability:${accountId}:${currencyId}`);
      const liabilityEffect = entryType === "payment" ? -amount : amount;
      let carryingRatePkr = exchangeRateToPkr;
      let carryingAmountPkr = pkrAmount;
      let actualSettlementPkr = pkrAmount;
      let realizedFxPkr = 0;
      if (entryType === "payment") {
        const outstanding = await tx.superAdminLiabilityEntry.aggregate({
          where: { accountId, currencyId },
          _sum: { liabilityEffect: true, pkrLiabilityEffect: true },
        });
        const settlement = calculateLiabilitySettlementFx({
          outstandingForeignAmount: Number(outstanding._sum.liabilityEffect || 0),
          outstandingCarryingPkr: Number(outstanding._sum.pkrLiabilityEffect || 0),
          settlementForeignAmount: amount,
          settlementRateToPkr: exchangeRateToPkr,
        });
        carryingRatePkr = settlement.carryingRatePkr;
        carryingAmountPkr = settlement.carryingAmountPkr;
        actualSettlementPkr = settlement.actualSettlementPkr;
        realizedFxPkr = settlement.realizedFxPkr;
      }
      const pkrLiabilityEffect = entryType === "payment" ? -carryingAmountPkr : pkrAmount;
      const entry = await tx.superAdminLiabilityEntry.create({
        data: {
          accountId,
          entryType: entryType as any,
          entryDate: new Date(body.entryDate || new Date()),
          currencyId,
          amount,
          liabilityEffect,
          exchangeRateToPkr,
          pkrAmount,
          pkrLiabilityEffect,
          carryingRatePkr,
          carryingAmountPkr,
          realizedFxPkr,
          rateSource,
          sourceType: sourceType as any,
          superAdminBankAccountId: source?.ok ? source.superAdminBankAccountId : null,
          superAdminCashAccountId: source?.ok ? source.superAdminCashAccountId : null,
          intermediaryId: source?.ok ? source.intermediaryId : null,
          bankAccountId: source?.ok ? source.bankAccountId : null,
          cityId: body.cityId ? Number(body.cityId) : null,
          counterAccountId,
          reference: body.reference ? String(body.reference).trim() : null,
          remarks: body.remarks ? String(body.remarks).trim() : null,
          createdBy: user.userId,
        },
      });
      await journalSuperAdminLiabilityEntry({
        id: entry.id,
        entryType: entryType as any,
        controlAccountId: account.controlAccountId,
        counterAccountId,
        pkrAmount,
        carryingAmountPkr,
        actualSettlementPkr,
        entryDate: entry.entryDate,
        createdBy: user.userId,
        sourceType,
        superAdminBankAccountId: entry.superAdminBankAccountId,
        superAdminCashAccountId: entry.superAdminCashAccountId,
        intermediaryId: entry.intermediaryId,
        bankAccountId: entry.bankAccountId,
        cityId: entry.cityId,
        description: `${account.name} — ${entryType.replaceAll("_", " ")}`,
      }, tx);
      await createAuditLog(user.userId, null, "super_admin_liability_entries", entry.id, "create", undefined, { accountId, entryType, amount, currencyCode, pkrAmount, carryingAmountPkr, realizedFxPkr, sourceType }, getClientIP(request), tx);
      return entry;
    });
    return successResponse({ id: created.id }, "Liability entry recorded", 201);
  } catch (error) {
    if (error instanceof SuperAdminLiabilitySettlementError) return validationError(error.message);
    console.error("Create superadmin liability entry:", error);
    return serverError();
  }
});
