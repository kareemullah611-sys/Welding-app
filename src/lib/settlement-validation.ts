import prisma from "@/lib/prisma";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { settlementAmountToPkr } from "@/lib/payment-currencies";

export type SettlementValidationInput = {
  amount: number;
  currencyCode: string;
  superAdminBankAccountId?: number | null;
  intermediaryId?: number | null;
  exchangeRate?: number | null;
  /** When paying USD liability from intermediary USD balance */
  liabilityCurrencyCode?: string;
};

export type SettlementValidationResult =
  | {
      ok: true;
      settlementCurrency: string;
      settlementAmount: number;
      amountPkr: number | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getSuperAdminBankBalance(
  accountId: number,
  db: typeof prisma = prisma
): Promise<{ balance: number; currencyCode: string } | null> {
  const account = await db.superAdminBankAccount.findUnique({
    where: { id: accountId },
    include: { currency: true },
  });
  if (!account?.isActive) return null;

  const currencyId = account.currencyId;
  const currencyCode = String(account.currency.code || "PKR").toUpperCase();

  const [incomingHaji, hajiTransfers, expenses, intermediaryDeposits, lotCosts] = await Promise.all([
    db.payment.groupBy({
      by: ["superAdminBankAccountId"],
      where: {
        superAdminBankAccountId: accountId,
        currencyId,
        destination: "haji",
        status: "active",
      },
      _sum: { amount: true },
    }),
    db.hajiTransfer.aggregate({
      where: { superAdminBankAccountId: accountId, currencyId },
      _sum: { amount: true },
    }),
    db.superAdminPersonalExpense.aggregate({
      where: { bankAccountId: accountId, deletedAt: null },
      _sum: { amount: true },
    }),
    db.intermediaryDeposit.aggregate({
      where: { superAdminBankAccountId: accountId, currencyId },
      _sum: { amount: true },
    }),
    db.lotCost.findMany({
      where: { superAdminBankAccountId: accountId, currencyCode },
      select: { amount: true },
    }),
  ]);

  const supplierPayments = await db.supplierPayment.findMany({
    where: { superAdminBankAccountId: accountId },
    select: { amountLocal: true, amountUsd: true, exchangeRate: true },
  });

  const incoming = Number(incomingHaji[0]?._sum.amount || 0) + Number(hajiTransfers._sum.amount || 0);
  const expenseOut = Number(expenses._sum.amount || 0);
  const intermediaryOut = Number(intermediaryDeposits._sum.amount || 0);
  const lotCostOut = lotCosts.reduce((s, r) => s + Number(r.amount || 0), 0);
  let supplierOut = 0;
  for (const p of supplierPayments) {
    const local = Number(p.amountLocal || 0);
    if (local > 0) supplierOut += local;
    else if (currencyCode === "PKR") {
      const rate = Number(p.exchangeRate || 0);
      if (rate > 0) supplierOut += Number(p.amountUsd) * rate;
    }
  }

  const balance = round2(incoming - expenseOut - intermediaryOut - lotCostOut - supplierOut);
  return { balance, currencyCode };
}

export async function validateLotCostSettlement(input: SettlementValidationInput): Promise<SettlementValidationResult> {
  const amount = Number(input.amount);
  const currencyCode = String(input.currencyCode || "PKR").toUpperCase();
  const bankId = input.superAdminBankAccountId ? Number(input.superAdminBankAccountId) : null;
  const intermediaryId = input.intermediaryId ? Number(input.intermediaryId) : null;

  if (bankId && intermediaryId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Choose either a bank account or an intermediary, not both" };
  }
  if (!bankId && !intermediaryId) {
    return { ok: true, settlementCurrency: currencyCode, settlementAmount: amount, amountPkr: currencyCode === "PKR" ? amount : null };
  }

  if (bankId) {
    const account = await prisma.superAdminBankAccount.findUnique({
      where: { id: bankId },
      include: { currency: true },
    });
    if (!account) return { ok: false, code: "NOT_FOUND", message: "Super admin bank account not found", status: 404 };
    if (!account.isActive) return { ok: false, code: "VALIDATION_ERROR", message: "Selected super admin bank account is inactive" };

    const bankCurrency = String(account.currency.code || "PKR").toUpperCase();
    let settlementAmount = amount;
    let amountPkr: number | null = null;

    if (bankCurrency === currencyCode) {
      settlementAmount = amount;
      amountPkr = currencyCode === "PKR" ? amount : settlementAmountToPkr(amount, currencyCode, Number(input.exchangeRate || 0));
    } else if (bankCurrency === "PKR" && currencyCode !== "PKR") {
      const rate = Number(input.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return { ok: false, code: "VALIDATION_ERROR", message: `Exchange rate (${currencyCode}→PKR) is required when paying from a PKR bank account` };
      }
      settlementAmount = round2(amount * rate);
      amountPkr = settlementAmount;
    } else {
      return { ok: false, code: "VALIDATION_ERROR", message: `Bank account currency (${bankCurrency}) does not match cost currency (${currencyCode})` };
    }

    const bal = await getSuperAdminBankBalance(bankId);
    if (!bal) return { ok: false, code: "NOT_FOUND", message: "Could not compute bank balance", status: 404 };
    if (settlementAmount > bal.balance + 0.001) {
      return {
        ok: false,
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient bank balance. Available: ${bal.balance.toLocaleString("en-US")} ${bal.currencyCode}`,
      };
    }

    return { ok: true, settlementCurrency: bankCurrency, settlementAmount, amountPkr };
  }

  const liabilityCode = String(input.liabilityCurrencyCode || currencyCode).toUpperCase();
  const balances = await getIntermediaryBalances(intermediaryId!);
  const available = Number(balances[liabilityCode] || 0);
  if (amount > available + 0.001) {
    return {
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      message: `Insufficient intermediary ${liabilityCode} balance. Available: ${available.toLocaleString("en-US")}`,
    };
  }

  if (liabilityCode === "PKR") {
    return { ok: true, settlementCurrency: "PKR", settlementAmount: amount, amountPkr: amount };
  }

  const rate = Number(input.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: `Acquisition rate (${liabilityCode}→PKR) is required when paying from intermediary` };
  }
  return { ok: true, settlementCurrency: liabilityCode, settlementAmount: amount, amountPkr: round2(amount * rate) };
}

export async function validateSupplierPaymentSettlement(input: {
  amountUsd: number;
  superAdminBankAccountId?: number | null;
  bankAccountId?: number | null;
  intermediaryId?: number | null;
  exchangeRate?: number | null;
  excludeSupplierPaymentId?: number | null;
}): Promise<SettlementValidationResult> {
  const amountUsd = Number(input.amountUsd);
  const superAdminBankId = input.superAdminBankAccountId ? Number(input.superAdminBankAccountId) : null;
  const cityBankId = input.bankAccountId ? Number(input.bankAccountId) : null;
  const intermediaryId = input.intermediaryId ? Number(input.intermediaryId) : null;

  if (superAdminBankId && intermediaryId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Choose either a bank account or an intermediary, not both" };
  }
  if (!superAdminBankId && !cityBankId && !intermediaryId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "A funding source is required" };
  }

  if (intermediaryId) {
    const rate = Number(input.exchangeRate);
    if (Number.isFinite(rate) && rate > 0) {
      // acquisition rate for PKR reporting — allowed but not used for balance check
    }
    const balances = await getIntermediaryBalances(intermediaryId, {
      excludeSupplierPaymentId: input.excludeSupplierPaymentId || undefined,
    });
    const available = Number(balances.USD || 0);
    if (amountUsd > available + 0.001) {
      return {
        ok: false,
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient intermediary USD balance. Available: $${available.toLocaleString("en-US")}`,
      };
    }
    const amountPkr = rate > 0 ? round2(amountUsd * rate) : null;
    return { ok: true, settlementCurrency: "USD", settlementAmount: amountUsd, amountPkr };
  }

  const bankId = superAdminBankId || cityBankId;
  if (!bankId) return { ok: false, code: "VALIDATION_ERROR", message: "Bank account required" };

  if (superAdminBankId) {
    const rate = Number(input.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return { ok: false, code: "VALIDATION_ERROR", message: "Exchange rate (USD→PKR) is required when paying from a bank account" };
    }
    const settlementAmount = round2(amountUsd * rate);
    const bal = await getSuperAdminBankBalance(superAdminBankId);
    if (!bal) return { ok: false, code: "NOT_FOUND", message: "Could not compute bank balance", status: 404 };
    if (settlementAmount > bal.balance + 0.001) {
      return {
        ok: false,
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient bank balance. Available: ${bal.balance.toLocaleString("en-US")} ${bal.currencyCode}`,
      };
    }
    return { ok: true, settlementCurrency: "PKR", settlementAmount, amountPkr: settlementAmount };
  }

  // Legacy city bank path
  const rate = Number(input.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Exchange rate is required when paying from a bank account" };
  }
  const settlementAmount = round2(amountUsd * rate);
  return { ok: true, settlementCurrency: "PKR", settlementAmount, amountPkr: settlementAmount };
}
