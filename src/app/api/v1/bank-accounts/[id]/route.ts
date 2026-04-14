import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

type LedgerRow = {
  key: string;
  date: Date;
  createdAt: Date;
  type: string;
  detail: string;
  reference: string | null;
  currencyCode: string;
  credit: number;
  debit: number;
  runningBalance?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const toCurrencyCode = (id: number, map: Record<number, string>) => map[id] || String(id);

const finalizeLedger = (rows: LedgerRow[]) => {
  const runningByCurrency: Record<string, number> = {};
  const asc = [...rows].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  for (const row of asc) {
    const curr = row.currencyCode;
    const current = runningByCurrency[curr] || 0;
    const next = round2(current + row.credit - row.debit);
    runningByCurrency[curr] = next;
    row.runningBalance = next;
  }
  return {
    ledger: asc.reverse(),
    balanceByCurrency: runningByCurrency,
  };
};

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

    if (request.nextUrl.searchParams.get("view") !== "ledger") {
      return errorResponse("VALIDATION_ERROR", "Unsupported view");
    }

    const currencyList = await prisma.currency.findMany({ select: { id: true, code: true } });
    const currencyCodeById = Object.fromEntries(currencyList.map((c) => [c.id, c.code])) as Record<number, string>;

    if (user.role === "super_admin") {
      const account = await prisma.superAdminBankAccount.findUnique({
        where: { id },
        include: { currency: true },
      });
      if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

      const [incomingHajiPayments, expenses, intermediaryDeposits, lotCosts] = await Promise.all([
        prisma.payment.findMany({
          where: {
            superAdminBankAccountId: id,
            destination: "haji",
            status: "active",
          },
          select: {
            id: true,
            paymentDate: true,
            createdAt: true,
            amount: true,
            detail: true,
            manualVoucherNo: true,
            currency: { select: { code: true } },
          },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.superAdminPersonalExpense.findMany({
          where: { bankAccountId: id, deletedAt: null },
          select: {
            id: true,
            expenseDate: true,
            createdAt: true,
            amount: true,
            detail: true,
            notes: true,
          },
          orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.intermediaryDeposit.findMany({
          where: { superAdminBankAccountId: id },
          include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.lotCost.findMany({
          where: { superAdminBankAccountId: id },
          include: { lot: { select: { lotNumber: true } } },
          orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
        }),
      ]);

      const rows: LedgerRow[] = [];
      for (const p of incomingHajiPayments) {
        rows.push({
          key: `pay-${p.id}`,
          date: new Date(p.paymentDate),
          createdAt: new Date(p.createdAt),
          type: "Payment In",
          detail: p.detail || "Customer payment",
          reference: p.manualVoucherNo || null,
          currencyCode: p.currency.code,
          credit: Number(p.amount),
          debit: 0,
        });
      }
      for (const e of expenses) {
        rows.push({
          key: `sa-exp-${e.id}`,
          date: new Date(e.expenseDate),
          createdAt: new Date(e.createdAt),
          type: "Personal Expense",
          detail: e.detail || "Super admin personal expense",
          reference: null,
          currencyCode: account.currency.code,
          credit: 0,
          debit: Number(e.amount),
        });
      }
      for (const d of intermediaryDeposits) {
        rows.push({
          key: `imd-${d.id}`,
          date: new Date(d.depositDate),
          createdAt: new Date(d.createdAt),
          type: "Intermediary Deposit",
          detail: `Deposit to ${d.intermediary.name}`,
          reference: null,
          currencyCode: d.currency.code,
          credit: 0,
          debit: Number(d.amount),
        });
      }
      for (const c of lotCosts) {
        if (String(c.currencyCode || "").toUpperCase() !== account.currency.code.toUpperCase()) continue;
        rows.push({
          key: `lotc-${c.id}`,
          date: new Date(c.costDate || c.createdAt),
          createdAt: new Date(c.createdAt),
          type: "Lot Cost",
          detail: `${c.description}${c.lot?.lotNumber ? ` (${c.lot.lotNumber})` : ""}`,
          reference: c.costType,
          currencyCode: account.currency.code,
          credit: 0,
          debit: Number(c.amount),
        });
      }

      const { ledger, balanceByCurrency } = finalizeLedger(rows);
      return successResponse({
        account: {
          id: account.id,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          currencyCode: account.currency.code,
          scope: "super_admin",
        },
        ledger,
        balanceByCurrency,
      });
    }

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);
    if (user.role === "city_admin" && account.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const [paymentsIn, deposits, depositedCheques, expenses, hajiTransfers, supplierPayments, shippingLinePayments, agentPayments, lotCosts, intermediaryDeposits] =
      await Promise.all([
        prisma.payment.findMany({
          where: { bankAccountId: id, destination: "our_account", status: "active" },
          select: { id: true, paymentDate: true, createdAt: true, amount: true, detail: true, manualVoucherNo: true, currencyId: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.bankDeposit.findMany({
          where: { bankAccountId: id },
          select: { id: true, depositDate: true, createdAt: true, cashAmount: true, slipNumber: true, currencyId: true },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.payment.findMany({
          where: { bankAccountId: id, bankDepositId: { not: null }, status: "active" },
          select: { id: true, paymentDate: true, createdAt: true, amount: true, chequeNumber: true, currencyId: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.expense.findMany({
          where: { bankAccountId: id, deletedAt: null },
          select: { id: true, expenseDate: true, createdAt: true, amount: true, detail: true, currencyId: true },
          orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.hajiTransfer.findMany({
          where: { bankAccountId: id, sourceType: "bank_transfer" },
          select: { id: true, transferDate: true, createdAt: true, amount: true, detail: true, currencyId: true },
          orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.supplierPayment.findMany({
          where: { bankAccountId: id },
          select: { id: true, paymentDate: true, createdAt: true, amountUsd: true, amountLocal: true, exchangeRate: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.shippingLinePayment.findMany({
          where: { bankAccountId: id },
          select: { id: true, paymentDate: true, createdAt: true, amountUsd: true, amountPkr: true, exchangeRate: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.agentPayment.findMany({
          where: { bankAccountId: id },
          select: { id: true, paymentDate: true, createdAt: true, amount: true, currencyCode: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.lotCost.findMany({
          where: { bankAccountId: id },
          include: { lot: { select: { lotNumber: true } } },
          orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.intermediaryDeposit.findMany({
          where: { bankAccountId: id },
          include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
      ]);

    const rows: LedgerRow[] = [];
    for (const p of paymentsIn) {
      rows.push({
        key: `pay-${p.id}`,
        date: new Date(p.paymentDate),
        createdAt: new Date(p.createdAt),
        type: "Payment In",
        detail: p.detail || "Customer payment",
        reference: p.manualVoucherNo || null,
        currencyCode: toCurrencyCode(p.currencyId, currencyCodeById),
        credit: Number(p.amount),
        debit: 0,
      });
    }
    for (const d of deposits) {
      rows.push({
        key: `dep-${d.id}`,
        date: new Date(d.depositDate),
        createdAt: new Date(d.createdAt),
        type: "Bank Deposit",
        detail: "Cash deposited",
        reference: d.slipNumber || null,
        currencyCode: toCurrencyCode(d.currencyId, currencyCodeById),
        credit: Number(d.cashAmount || 0),
        debit: 0,
      });
    }
    for (const c of depositedCheques) {
      rows.push({
        key: `chq-${c.id}`,
        date: new Date(c.paymentDate),
        createdAt: new Date(c.createdAt),
        type: "Cheque Deposit",
        detail: "Cheque deposited to bank",
        reference: c.chequeNumber || null,
        currencyCode: toCurrencyCode(c.currencyId, currencyCodeById),
        credit: Number(c.amount),
        debit: 0,
      });
    }
    for (const e of expenses) {
      rows.push({
        key: `exp-${e.id}`,
        date: new Date(e.expenseDate),
        createdAt: new Date(e.createdAt),
        type: "Expense",
        detail: e.detail || "Expense payment",
        reference: null,
        currencyCode: toCurrencyCode(e.currencyId, currencyCodeById),
        credit: 0,
        debit: Number(e.amount),
      });
    }
    for (const h of hajiTransfers) {
      rows.push({
        key: `haji-${h.id}`,
        date: new Date(h.transferDate),
        createdAt: new Date(h.createdAt),
        type: "Haji Transfer",
        detail: h.detail || "Transfer to haji",
        reference: null,
        currencyCode: toCurrencyCode(h.currencyId, currencyCodeById),
        credit: 0,
        debit: Number(h.amount),
      });
    }
    for (const s of supplierPayments) {
      const amountPkr = Number(s.amountLocal || 0) > 0 ? Number(s.amountLocal) : (Number(s.exchangeRate || 0) > 0 ? Number(s.amountUsd) * Number(s.exchangeRate) : 0);
      rows.push({
        key: `sup-${s.id}`,
        date: new Date(s.paymentDate),
        createdAt: new Date(s.createdAt),
        type: "Supplier Payment",
        detail: "Payment to supplier",
        reference: s.reference || null,
        currencyCode: amountPkr > 0 ? "PKR" : "USD",
        credit: 0,
        debit: amountPkr > 0 ? round2(amountPkr) : Number(s.amountUsd),
      });
    }
    for (const s of shippingLinePayments) {
      const amountPkr = Number(s.amountPkr || 0) > 0 ? Number(s.amountPkr) : (Number(s.exchangeRate || 0) > 0 ? Number(s.amountUsd) * Number(s.exchangeRate) : 0);
      rows.push({
        key: `ship-${s.id}`,
        date: new Date(s.paymentDate),
        createdAt: new Date(s.createdAt),
        type: "Shipping Payment",
        detail: "Payment to shipping line",
        reference: s.reference || null,
        currencyCode: amountPkr > 0 ? "PKR" : "USD",
        credit: 0,
        debit: amountPkr > 0 ? round2(amountPkr) : Number(s.amountUsd),
      });
    }
    for (const a of agentPayments) {
      rows.push({
        key: `agent-${a.id}`,
        date: new Date(a.paymentDate),
        createdAt: new Date(a.createdAt),
        type: "Agent Payment",
        detail: "Payment to agent",
        reference: a.reference || null,
        currencyCode: String(a.currencyCode || "").toUpperCase() || "PKR",
        credit: 0,
        debit: Number(a.amount),
      });
    }
    for (const c of lotCosts) {
      rows.push({
        key: `lotc-${c.id}`,
        date: new Date(c.costDate || c.createdAt),
        createdAt: new Date(c.createdAt),
        type: "Lot Cost",
        detail: `${c.description}${c.lot?.lotNumber ? ` (${c.lot.lotNumber})` : ""}`,
        reference: c.costType,
        currencyCode: String(c.currencyCode || "").toUpperCase() || "PKR",
        credit: 0,
        debit: Number(c.amount),
      });
    }
    for (const d of intermediaryDeposits) {
      rows.push({
        key: `imd-${d.id}`,
        date: new Date(d.depositDate),
        createdAt: new Date(d.createdAt),
        type: "Intermediary Deposit",
        detail: `Deposit to ${d.intermediary.name}`,
        reference: null,
        currencyCode: d.currency.code,
        credit: 0,
        debit: Number(d.amount),
      });
    }

    const { ledger, balanceByCurrency } = finalizeLedger(rows);
    return successResponse({
      account: {
        id: account.id,
        cityId: account.cityId,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        scope: "city",
      },
      ledger,
      balanceByCurrency,
    });
  } catch (error) {
    return serverError();
  }
});

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const id = parseInt(context.params.id);
      if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

      const account = await prisma.superAdminBankAccount.findUnique({ where: { id } });
      if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

      const body = await request.json();
      const updateData: any = {};

      if (body.bankName !== undefined) {
        const bankName = String(body.bankName).trim();
        if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName cannot be empty");
        if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
        updateData.bankName = bankName;
      }

      if (body.accountNumber !== undefined) {
        updateData.accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
      }

      if (body.isActive !== undefined) {
        updateData.isActive = Boolean(body.isActive);
      }

      if (body.currencyId !== undefined) {
        const currencyId = Number(body.currencyId);
        if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "currencyId is required");
        const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
        if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);
        updateData.currencyId = currencyId;
      }

      if (Object.keys(updateData).length === 0) {
        return errorResponse("VALIDATION_ERROR", "No valid fields to update");
      }

      const oldValues = {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        isActive: account.isActive,
        currencyId: account.currencyId,
      };

      const updated = await prisma.superAdminBankAccount.update({
        where: { id },
        data: updateData,
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_bank_accounts",
        id,
        "update",
        oldValues,
        updateData,
        getClientIP(request)
      );

      return successResponse(
        {
          id: updated.id,
          cityId: null,
          bankName: updated.bankName,
          accountNumber: updated.accountNumber,
          isActive: updated.isActive,
          currencyId: updated.currencyId,
          accountScope: "super_admin",
        },
        "Bank account updated"
      );
    }
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

    // city_admin can only modify accounts in their own city
    if (user.role === "city_admin" && account.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    const body = await request.json();
    const updateData: any = {};

    if (body.bankName !== undefined) {
      const bankName = String(body.bankName).trim();
      if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName cannot be empty");
      if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
      updateData.bankName = bankName;
    }

    if (body.accountNumber !== undefined) {
      updateData.accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
    }

    if (body.isActive !== undefined) {
      updateData.isActive = Boolean(body.isActive);
    }

    if (Object.keys(updateData).length === 0) {
      return errorResponse("VALIDATION_ERROR", "No valid fields to update");
    }

    const oldValues = {
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      isActive: account.isActive,
    };

    const updated = await prisma.bankAccount.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog(
      user.userId,
      account.cityId,
      "bank_accounts",
      id,
      "update",
      oldValues,
      updateData,
      getClientIP(request)
    );

    return successResponse(
      {
        id: updated.id,
        cityId: updated.cityId,
        bankName: updated.bankName,
        accountNumber: updated.accountNumber,
        isActive: updated.isActive,
      },
      "Bank account updated"
    );
  } catch (error) {
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const id = parseInt(context.params.id);
      if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

      const account = await prisma.superAdminBankAccount.findUnique({ where: { id } });
      if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);
      if (!account.isActive) return errorResponse("VALIDATION_ERROR", "Bank account is already inactive");

      await prisma.superAdminBankAccount.update({
        where: { id },
        data: { isActive: false },
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_bank_accounts",
        id,
        "delete",
        { bankName: account.bankName, accountNumber: account.accountNumber, isActive: true, currencyId: account.currencyId },
        { isActive: false },
        getClientIP(request)
      );

      return successResponse({ id }, "Bank account deactivated");
    }
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid bank account id");

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);

    // city_admin can only modify accounts in their own city
    if (user.role === "city_admin" && account.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    if (!account.isActive) {
      return errorResponse("VALIDATION_ERROR", "Bank account is already inactive");
    }

    // Soft-delete: set isActive = false instead of removing the row
    await prisma.bankAccount.update({
      where: { id },
      data: { isActive: false },
    });

    await createAuditLog(
      user.userId,
      account.cityId,
      "bank_accounts",
      id,
      "delete",
      { bankName: account.bankName, accountNumber: account.accountNumber, isActive: true },
      { isActive: false },
      getClientIP(request)
    );

    return successResponse({ id }, "Bank account deactivated");
  } catch (error) {
    return serverError();
  }
});
