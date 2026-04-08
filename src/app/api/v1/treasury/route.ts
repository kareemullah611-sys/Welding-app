import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// Helper: build a currency-keyed balance map from an array of { currencyCode, total } rows
function toBalanceMap(rows: { currencyCode: string; total: number }[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.currencyCode] = (map[row.currencyCode] || 0) + row.total;
  }
  return map;
}

// Helper: subtract one balance map from another (result may be 0 but never stored if absent)
function subtractMap(
  base: Record<string, number>,
  deductions: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = { ...base };
  for (const [code, amount] of Object.entries(deductions)) {
    result[code] = (result[code] || 0) - amount;
  }
  return result;
}

// Helper: merge/add two balance maps
function addMap(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = { ...a };
  for (const [code, amount] of Object.entries(b)) {
    result[code] = (result[code] || 0) + amount;
  }
  return result;
}

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedCityId = searchParams.get("cityId")
      ? parseInt(searchParams.get("cityId")!)
      : undefined;
    const cityId = getCityScope(user, requestedCityId);

    if (!cityId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "cityId is required for super_admin when not filtering by city"
      );
    }

    // ----------------------------------------------------------------
    // 1. CASH IN OFFICE
    //    = cash payments (our_account, active)
    //    - haji transfers from cash_office
    //    - expenses paid from cash_office (not deleted)
    //    - bank deposits cash amounts
    // ----------------------------------------------------------------

    // Cash payments into our account
    const cashPaymentsRaw = await prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: "cash",
        destination: "our_account",
        status: "active",
      },
      _sum: { amount: true },
    });

    // Haji transfers out of cash_office
    const hajiFromCashRaw = await prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        sourceType: "cash_office",
      },
      _sum: { amount: true },
    });

    // Expenses paid from cash_office (not soft-deleted)
    const expensesFromCashRaw = await prisma.expense.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paidFrom: "cash_office",
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    // Cash deposited to bank (reduces cash in office)
    const depositsRaw = await prisma.bankDeposit.groupBy({
      by: ["currencyId"],
      where: { cityId },
      _sum: { cashAmount: true },
    });

    // Fix P1: personal withdrawals reduce physical cash on hand — previously missing from
    // the formula so treasury was overstating cash in office by every withdrawal ever recorded.
    const withdrawalsRaw = await prisma.personalWithdrawal.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "cash_office" } as any,
      _sum: { amount: true },
    });

    // Resolve currency codes for all currency IDs encountered
    const allCurrencyIds = Array.from(
      new Set([
        ...cashPaymentsRaw.map((r) => r.currencyId),
        ...hajiFromCashRaw.map((r) => r.currencyId),
        ...expensesFromCashRaw.map((r) => r.currencyId),
        ...depositsRaw.map((r) => r.currencyId),
        ...withdrawalsRaw.map((r) => r.currencyId),
      ])
    );

    const currencies =
      allCurrencyIds.length > 0
        ? await prisma.currency.findMany({
            where: { id: { in: allCurrencyIds } },
            select: { id: true, code: true },
          })
        : [];

    const codeById: Record<number, string> = {};
    for (const c of currencies) codeById[c.id] = c.code;

    // Build intermediate maps
    const cashIn = toBalanceMap(
      cashPaymentsRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    const hajiCashOut = toBalanceMap(
      hajiFromCashRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    const expenseCashOut = toBalanceMap(
      expensesFromCashRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    const depositCashOut = toBalanceMap(
      depositsRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.cashAmount ?? 0),
      }))
    );

    const withdrawalsCashOut = toBalanceMap(
      withdrawalsRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum?.amount ?? 0),
      }))
    );

    const cashInOffice = subtractMap(
      subtractMap(subtractMap(subtractMap(cashIn, hajiCashOut), expenseCashOut), depositCashOut),
      withdrawalsCashOut
    );

    // ----------------------------------------------------------------
    // 2. CHEQUES IN HAND
    //    = cheque payments (our_account, active, chequeStatus = in_hand)
    // ----------------------------------------------------------------

    const chequesInHandRaw = await prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: "cheque",
        destination: "our_account",
        status: "active",
        chequeStatus: "in_hand",
      },
      _sum: { amount: true },
    });

    const chequesInHandCurrencyIds = chequesInHandRaw.map((r) => r.currencyId);
    const missingChequeIds = chequesInHandCurrencyIds.filter((id) => !codeById[id]);
    if (missingChequeIds.length > 0) {
      const extraCurrencies = await prisma.currency.findMany({
        where: { id: { in: missingChequeIds } },
        select: { id: true, code: true },
      });
      for (const c of extraCurrencies) codeById[c.id] = c.code;
    }

    const chequesInHand = toBalanceMap(
      chequesInHandRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    // ----------------------------------------------------------------
    // 3. BANK BALANCE
    //    = bank_transfer + online payments (our_account, active)
    //    + cash deposited to bank
    //    + cheques deposited to bank (deposited_to_bank)
    //    - haji transfers from bank_transfer
    //    - expenses paid from bank_account (not deleted)
    // ----------------------------------------------------------------

    // Bank/online payments in
    const bankPaymentsRaw = await prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: { in: ["bank_transfer", "online"] },
        destination: "our_account",
        status: "active",
        bankAccountId: { not: null },
      },
      _sum: { amount: true },
    } as any);

    // Cheques that have been deposited to bank (for this city)
    const depositedChequesRaw = await prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: "cheque",
        destination: "our_account",
        status: "active",
        chequeStatus: "deposited_to_bank",
      },
      _sum: { amount: true },
    });

    // Haji transfers out of bank
    const hajiFromBankRaw = await prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        sourceType: "bank_transfer",
      },
      _sum: { amount: true },
    });

    // Expenses paid from bank_account (not soft-deleted)
    const expensesFromBankRaw = await prisma.expense.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paidFrom: "bank_account",
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    // Ensure all new currency IDs are resolved
    const newIds = [
      ...bankPaymentsRaw.map((r) => r.currencyId),
      ...depositedChequesRaw.map((r) => r.currencyId),
      ...hajiFromBankRaw.map((r) => r.currencyId),
      ...expensesFromBankRaw.map((r) => r.currencyId),
    ].filter((id) => !codeById[id]);

    if (newIds.length > 0) {
      const extra = await prisma.currency.findMany({
        where: { id: { in: Array.from(new Set(newIds)) } },
        select: { id: true, code: true },
      });
      for (const c of extra) codeById[c.id] = c.code;
    }

    const bankPaymentsIn = toBalanceMap(
      bankPaymentsRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum?.amount ?? 0),
      }))
    );

    const depositedChequesIn = toBalanceMap(
      depositedChequesRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    const hajiFromBankOut = toBalanceMap(
      hajiFromBankRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    const expenseBankOut = toBalanceMap(
      expensesFromBankRaw.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(r._sum.amount ?? 0),
      }))
    );

    // bankBalance = bankPaymentsIn + depositCashIn + depositedChequesIn - hajiOut - expensesOut
    let bankBalance = addMap(addMap(addMap(bankPaymentsIn, depositCashOut), depositedChequesIn), {});
    bankBalance = subtractMap(subtractMap(bankBalance, hajiFromBankOut), expenseBankOut);

    // ----------------------------------------------------------------
    // 4. Per-account bank breakdown
    // ----------------------------------------------------------------

    const bankAccounts = await prisma.bankAccount.findMany({
      where: { cityId, isActive: true },
      select: { id: true, bankName: true, accountNumber: true },
    });

    // For each bank account, compute its own balance slice
    // Formula per account:
    //   bank/online payments directed to this account
    //   + deposits to this account (cashAmount)
    //   + cheques deposited via deposits linked to this account
    //   - haji transfers from this bank account
    //   - expenses from this bank account
    //
    const perAccountBalances: Array<{
      id: number;
      bankName: string;
      accountNumber: string | null;
      balance: Record<string, number>;
    }> = [];

    for (const acct of bankAccounts) {
      // Deposits (cash) into this account
      const acctBankPaymentsRaw = await prisma.payment.groupBy({
        by: ["currencyId"],
        where: {
          cityId,
          paymentMethod: { in: ["bank_transfer", "online"] },
          destination: "our_account",
          status: "active",
          bankAccountId: acct.id,
        },
        _sum: { amount: true },
      } as any);

      const acctDepositsRaw = await prisma.bankDeposit.groupBy({
        by: ["currencyId"],
        where: { cityId, bankAccountId: acct.id },
        _sum: { cashAmount: true },
      });

      // Cheques deposited via this account's deposit slips
      const acctDepositIds = await prisma.bankDeposit.findMany({
        where: { cityId, bankAccountId: acct.id },
        select: { id: true },
      });
      const depositIds = acctDepositIds.map((d) => d.id);

      const acctDepositedChequesRaw =
        depositIds.length > 0
          ? await prisma.payment.groupBy({
              by: ["currencyId"],
              where: {
                cityId,
                paymentMethod: "cheque",
                destination: "our_account",
                status: "active",
                chequeStatus: "deposited_to_bank",
                bankDepositId: { in: depositIds },
              },
              _sum: { amount: true },
            })
          : [];

      // Haji transfers from this bank account
      const acctHajiRaw = await prisma.hajiTransfer.groupBy({
        by: ["currencyId"],
        where: { cityId, bankAccountId: acct.id },
        _sum: { amount: true },
      });

      // Expenses from this bank account
      const acctExpensesRaw = await prisma.expense.groupBy({
        by: ["currencyId"],
        where: { cityId, bankAccountId: acct.id, deletedAt: null },
        _sum: { amount: true },
      });

      // Ensure currencies are resolved
      const acctNewIds = [
        ...acctBankPaymentsRaw.map((r) => r.currencyId),
        ...acctDepositsRaw.map((r) => r.currencyId),
        ...acctDepositedChequesRaw.map((r) => r.currencyId),
        ...acctHajiRaw.map((r) => r.currencyId),
        ...acctExpensesRaw.map((r) => r.currencyId),
      ].filter((id) => !codeById[id]);

      if (acctNewIds.length > 0) {
        const extra = await prisma.currency.findMany({
          where: { id: { in: Array.from(new Set(acctNewIds)) } },
          select: { id: true, code: true },
        });
        for (const c of extra) codeById[c.id] = c.code;
      }

      const acctBankPaymentsIn = toBalanceMap(
        acctBankPaymentsRaw.map((r) => ({
          currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
          total: Number(r._sum?.amount ?? 0),
        }))
      );

      const acctDepositsIn = toBalanceMap(
        acctDepositsRaw.map((r) => ({
          currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
          total: Number(r._sum.cashAmount ?? 0),
        }))
      );

      const acctChequesIn = toBalanceMap(
        acctDepositedChequesRaw.map((r) => ({
          currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
          total: Number(r._sum.amount ?? 0),
        }))
      );

      const acctHajiOut = toBalanceMap(
        acctHajiRaw.map((r) => ({
          currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
          total: Number(r._sum.amount ?? 0),
        }))
      );

      const acctExpensesOut = toBalanceMap(
        acctExpensesRaw.map((r) => ({
          currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
          total: Number(r._sum.amount ?? 0),
        }))
      );

      const acctBalance = subtractMap(
        subtractMap(addMap(addMap(acctBankPaymentsIn, acctDepositsIn), acctChequesIn), acctHajiOut),
        acctExpensesOut
      );

      perAccountBalances.push({
        id: acct.id,
        bankName: acct.bankName,
        accountNumber: acct.accountNumber,
        balance: acctBalance,
      });
    }

    return successResponse({
      cashInOffice,
      chequesInHand,
      bankBalance,
      hasBankAccounts: bankAccounts.length > 0,
      bankAccounts: perAccountBalances,
    });
  } catch (error) {
    return serverError();
  }
});
