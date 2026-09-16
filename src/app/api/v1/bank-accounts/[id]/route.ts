import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { finalizeLedgerForDisplay } from "@/lib/ledger-display";
import { getLedgerPaginationParams, paginateList } from "@/lib/pagination";
import { formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";

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
const paymentMethodLabel = (method?: string | null) => method === "online" ? "online" : method === "bank_transfer" ? "bank transfer" : method || "payment";
const withRef = (detail: string, ref?: string | null) => ref ? `${detail} — Ref ${ref}` : detail;

function respondLedgerView(
  searchParams: URLSearchParams,
  account: Record<string, unknown>,
  rows: LedgerRow[],
) {
  const { page, limit } = getLedgerPaginationParams(searchParams);
  const { ledger, balanceByCurrency } = finalizeLedgerForDisplay(rows);
  const { items: pagedLedger, pagination } = paginateList(ledger, page, limit);
  return NextResponse.json({
    success: true,
    data: { account, ledger: pagedLedger, balanceByCurrency },
    pagination,
  });
}

async function appendSuperAdminControlRows(accountId: number, currencyCode: string, rows: LedgerRow[]) {
  const [transfers, liabilityEntries] = await Promise.all([
    prisma.superAdminAccountTransfer.findMany({
      where: { reversedAt: null, OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }] },
      include: {
        sourceAccount: { select: { bankName: true } },
        destinationAccount: { select: { bankName: true } },
        fromCurrency: { select: { code: true } },
        toCurrency: { select: { code: true } },
      },
      orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.superAdminLiabilityEntry.findMany({
      where: { OR: [{ superAdminBankAccountId: accountId }, { superAdminCashAccountId: accountId }] },
      include: { account: { select: { name: true } }, currency: { select: { code: true } } },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  for (const transfer of transfers) {
    const incoming = transfer.destinationAccountId === accountId;
    rows.push({
      key: `satrans-${transfer.id}-${incoming ? "in" : "out"}`,
      date: new Date(transfer.transferDate),
      createdAt: new Date(transfer.createdAt),
      type: transfer.transferType === "exchange" ? "Account Exchange" : "Account Transfer",
      detail: incoming ? `From ${transfer.sourceAccount.bankName}` : `To ${transfer.destinationAccount.bankName}`,
      reference: transfer.reference,
      currencyCode: incoming ? transfer.toCurrency.code : transfer.fromCurrency.code,
      credit: incoming ? Number(transfer.toAmount) : 0,
      debit: incoming ? 0 : Number(transfer.fromAmount),
    });
  }
  for (const entry of liabilityEntries) {
    const sourceIncrease = Number(entry.liabilityEffect) > 0;
    rows.push({
      key: `saliab-${entry.id}`,
      date: new Date(entry.entryDate),
      createdAt: new Date(entry.createdAt),
      type: sourceIncrease ? "Liability Receipt/Reversal" : "Liability Payment",
      detail: entry.account.name,
      reference: entry.reference,
      currencyCode: entry.currency.code || currencyCode,
      credit: sourceIncrease ? Number(entry.amount) : 0,
      debit: sourceIncrease ? 0 : Number(entry.amount),
    });
  }
}

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

      if (account.accountKind === "cash") {
        const currencyCode = String(account.currency.code || "").toUpperCase();
        const accountLabel = formatSuperAdminBankLabel(account);
        const [
          openingBalance,
          hajiTransfersIn,
          cashReceipts,
          intermediaryOut,
          supplierPayments,
          agentPayments,
          shippingPayments,
          investorSettlementPayments,
        ] = await Promise.all([
          prisma.openingSuperAdminAccountBalance.findUnique({ where: { accountId: id } }),
          prisma.hajiTransfer.findMany({
            where: {
              currencyId: account.currencyId,
              OR: [
                {
                  superAdminCashAccountId: id,
                  settlementDestination: "super_admin_cash",
                },
                {
                  superAdminCashAccountId: null,
                  superAdminBankAccountId: null,
                  transferredTo: accountLabel,
                },
              ],
            },
            include: {
              city: { select: { name: true } },
              currency: { select: { code: true } },
            },
            orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }],
          }),
          prisma.hajiCashReceipt.findMany({
            where: { superAdminCashAccountId: id, reversedAt: null },
            include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
            orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
          }),
          prisma.intermediaryDeposit.findMany({
            where: { superAdminCashAccountId: id, deletedAt: null },
            include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
            orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
          }),
          prisma.supplierPayment.findMany({
            where: { superAdminCashAccountId: id, deletedAt: null },
            include: { supplier: { select: { name: true } }, lot: { select: { lotNumber: true } } },
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          }),
          prisma.agentPayment.findMany({
            where: { superAdminCashAccountId: id, currencyCode, deletedAt: null },
            include: { agent: { select: { name: true, agentType: true } } },
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          }),
          prisma.shippingLinePayment.findMany({
            where: { superAdminCashAccountId: id, deletedAt: null },
            include: { shippingLine: { select: { name: true } }, lot: { select: { lotNumber: true } } },
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          }),
          (prisma as any).investmentParticipantSettlementPayment.findMany({
            where: { superAdminBankAccountId: id, status: "settled" },
            include: { participant: { select: { name: true } }, currency: { select: { code: true } } },
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          }),
        ]);

        const rows: LedgerRow[] = [];
        if (openingBalance) {
          rows.push({
            key: `opening-sa-${openingBalance.id}`,
            date: new Date(openingBalance.openingDate),
            createdAt: new Date(openingBalance.createdAt),
            type: "Opening Balance",
            detail: openingBalance.notes || "Opening superadmin cash balance",
            reference: null,
            currencyCode,
            credit: Number(openingBalance.amount),
            debit: 0,
          });
        }
        for (const t of hajiTransfersIn) {
          rows.push({
            key: `ht-${t.id}`,
            date: new Date(t.transferDate),
            createdAt: new Date(t.createdAt),
            type: "Haji Transfer",
            detail: `${t.city?.name || "City"} — ${t.detail || "Transfer"}`,
            reference: null,
            currencyCode: t.currency.code,
            credit: Number(t.amount),
            debit: 0,
          });
        }
        for (const r of cashReceipts) {
          rows.push({
            key: `hcr-${r.id}`,
            date: new Date(r.receiptDate),
            createdAt: new Date(r.createdAt),
            type: "Receive",
            detail: `From ${r.intermediary.name}`,
            reference: r.notes || null,
            currencyCode: r.currency.code,
            credit: Number(r.amount),
            debit: 0,
          });
        }
        for (const d of intermediaryOut) {
          rows.push({
            key: `imdc-${d.id}`,
            date: new Date(d.depositDate),
            createdAt: new Date(d.createdAt),
            type: "Send — Intermediary",
            detail: `To ${d.intermediary.name}`,
            reference: d.notes || null,
            currencyCode: d.currency.code,
            credit: 0,
            debit: Number(d.amount),
          });
        }
        for (const p of supplierPayments) {
          const debit = Number(p.amountLocal || 0) > 0 ? Number(p.amountLocal) : Number(p.amountUsd);
          rows.push({
            key: `spc-${p.id}`,
            date: new Date(p.paymentDate),
            createdAt: new Date(p.createdAt),
            type: "Send — Supplier",
            detail: `${p.supplier.name}${p.lot?.lotNumber ? ` (${p.lot.lotNumber})` : ""}`,
            reference: p.reference || null,
            currencyCode,
            credit: 0,
            debit,
          });
        }
        for (const p of agentPayments) {
          rows.push({
            key: `apc-${p.id}`,
            date: new Date(p.paymentDate),
            createdAt: new Date(p.createdAt),
            type: p.agent.agentType === "customs" ? "Send — Customs Agent" : "Send — Clearing Agent",
            detail: p.agent.name,
            reference: p.reference || null,
            currencyCode: p.currencyCode,
            credit: 0,
            debit: Number(p.amount),
          });
        }
        for (const p of shippingPayments) {
          const debit = Number(p.amountPkr || 0) > 0 ? Number(p.amountPkr) : Number(p.amountUsd);
          rows.push({
            key: `slpc-${p.id}`,
            date: new Date(p.paymentDate),
            createdAt: new Date(p.createdAt),
            type: "Send — Shipping Line",
            detail: `${p.shippingLine.name}${p.lot?.lotNumber ? ` (${p.lot.lotNumber})` : ""}`,
            reference: p.reference || null,
            currencyCode,
            credit: 0,
            debit,
          });
        }
        for (const p of investorSettlementPayments) {
          rows.push({
            key: `invsettle-pay-${p.id}`,
            date: new Date(p.paymentDate),
            createdAt: new Date(p.createdAt),
            type: "Investor Settlement",
            detail: `Paid to ${p.participant?.name || "participant"}`,
            reference: p.paymentReference || null,
            currencyCode: p.currency.code,
            credit: 0,
            debit: Number(p.paymentAmount),
          });
        }
        await appendSuperAdminControlRows(id, currencyCode, rows);

        return respondLedgerView(request.nextUrl.searchParams, {
          id: account.id,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          currencyCode: account.currency.code,
          accountKind: account.accountKind,
          currencyId: account.currencyId,
          scope: "super_admin",
        }, rows);
      }

      const accountLabel = formatSuperAdminBankLabel(account);
      const currencyCode = String(account.currency.code || "").toUpperCase();
      const [openingBalance, incomingHajiPayments, hajiTransfersIn, intermediaryReturns, expenses, intermediaryDeposits, lotCosts, supplierPayments, agentPayments, shippingPayments, investorSettlementPayments] = await Promise.all([
        prisma.openingSuperAdminAccountBalance.findUnique({ where: { accountId: id } }),
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
        prisma.hajiTransfer.findMany({
          where: {
            OR: [
              { superAdminBankAccountId: id },
              {
                superAdminBankAccountId: null,
                superAdminCashAccountId: null,
                transferredTo: accountLabel,
              },
            ],
          },
          include: {
            city: { select: { name: true } },
            currency: { select: { code: true } },
          },
          orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.hajiCashReceipt.findMany({
          where: { superAdminCashAccountId: id, reversedAt: null },
          include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
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
          where: { superAdminBankAccountId: id, deletedAt: null },
          include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.lotCost.findMany({
          where: { superAdminBankAccountId: id },
          include: { lot: { select: { lotNumber: true } } },
          orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.supplierPayment.findMany({
          where: { superAdminBankAccountId: id, deletedAt: null },
          include: { supplier: { select: { name: true } }, lot: { select: { lotNumber: true } } },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.agentPayment.findMany({
          where: { superAdminBankAccountId: id, currencyCode, deletedAt: null },
          include: { agent: { select: { name: true, agentType: true } } },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.shippingLinePayment.findMany({
          where: { superAdminBankAccountId: id, deletedAt: null },
          include: { shippingLine: { select: { name: true } }, lot: { select: { lotNumber: true } } },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        (prisma as any).investmentParticipantSettlementPayment.findMany({
          where: { superAdminBankAccountId: id, status: "settled" },
          include: { participant: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
      ]);

      const rows: LedgerRow[] = [];
      if (openingBalance) {
        rows.push({
          key: `opening-sa-${openingBalance.id}`,
          date: new Date(openingBalance.openingDate),
          createdAt: new Date(openingBalance.createdAt),
          type: "Opening Balance",
          detail: openingBalance.notes || "Opening superadmin bank balance",
          reference: null,
          currencyCode,
          credit: Number(openingBalance.amount),
          debit: 0,
        });
      }
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
      for (const t of hajiTransfersIn) {
        rows.push({
          key: `ht-${t.id}`,
          date: new Date(t.transferDate),
          createdAt: new Date(t.createdAt),
          type: "Haji Transfer",
          detail: `${t.city?.name || "City"} — ${t.detail || "Transfer"}`,
          reference: t.referenceNo || null,
          currencyCode: t.currency.code,
          credit: Number(t.amount),
          debit: 0,
        });
      }
      for (const receipt of intermediaryReturns) {
        rows.push({
          key: `hcr-${receipt.id}`,
          date: new Date(receipt.receiptDate),
          createdAt: new Date(receipt.createdAt),
          type: "Intermediary Return",
          detail: `Received from ${receipt.intermediary.name}${receipt.notes ? ` — ${receipt.notes}` : ""}`,
          reference: null,
          currencyCode: receipt.currency.code,
          credit: Number(receipt.amount),
          debit: 0,
        });
      }
      for (const e of expenses) {
        rows.push({
          key: `sa-exp-${e.id}`,
          date: new Date(e.expenseDate),
          createdAt: new Date(e.createdAt),
          type: "Home Expense",
          detail: e.detail || "Super admin home expense",
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
      for (const p of supplierPayments) {
        const debit = Number(p.amountLocal || 0) > 0 ? Number(p.amountLocal) : Number(p.amountUsd);
        rows.push({
          key: `sp-${p.id}`,
          date: new Date(p.paymentDate),
          createdAt: new Date(p.createdAt),
          type: "Send — Supplier",
          detail: `${p.supplier.name}${p.lot?.lotNumber ? ` (${p.lot.lotNumber})` : ""}`,
          reference: p.reference || null,
          currencyCode,
          credit: 0,
          debit,
        });
      }
      for (const p of agentPayments) {
        rows.push({
          key: `ap-${p.id}`,
          date: new Date(p.paymentDate),
          createdAt: new Date(p.createdAt),
          type: p.agent.agentType === "customs" ? "Send — Customs Agent" : "Send — Clearing Agent",
          detail: p.agent.name,
          reference: p.reference || null,
          currencyCode: p.currencyCode,
          credit: 0,
          debit: Number(p.amount),
        });
      }
      for (const p of shippingPayments) {
        const debit = currencyCode === "PKR" ? Number(p.amountPkr || 0) : Number(p.amountUsd || 0);
        rows.push({
          key: `slp-${p.id}`,
          date: new Date(p.paymentDate),
          createdAt: new Date(p.createdAt),
          type: "Send — Shipping Line",
          detail: `${p.shippingLine.name}${p.lot?.lotNumber ? ` (${p.lot.lotNumber})` : ""}`,
          reference: p.reference || null,
          currencyCode,
          credit: 0,
          debit,
        });
      }
      for (const p of investorSettlementPayments) {
        rows.push({
          key: `invsettle-pay-${p.id}`,
          date: new Date(p.paymentDate),
          createdAt: new Date(p.createdAt),
          type: "Investor Settlement",
          detail: `Paid to ${p.participant?.name || "participant"}`,
          reference: p.paymentReference || null,
          currencyCode: p.currency.code,
          credit: 0,
          debit: Number(p.paymentAmount),
        });
      }
      await appendSuperAdminControlRows(id, currencyCode, rows);

      return respondLedgerView(request.nextUrl.searchParams, {
        id: account.id,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        currencyCode: account.currency.code,
        accountKind: account.accountKind,
        currencyId: account.currencyId,
        scope: "super_admin",
      }, rows);
    }

    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return errorResponse("NOT_FOUND", "Bank account not found", 404);
    if (user.role === "city_admin" && account.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const [paymentsIn, deposits, depositedCheques, expenses, hajiTransfers, supplierPayments, shippingLinePayments, agentPayments, lotCosts, intermediaryDeposits, liabilityEntries] =
      await Promise.all([
        prisma.payment.findMany({
          where: { bankAccountId: id, destination: "our_account", status: "active", cityId: account.cityId },
          select: {
            id: true,
            paymentDate: true,
            createdAt: true,
            amount: true,
            detail: true,
            manualVoucherNo: true,
            paymentMethod: true,
            currencyId: true,
            customer: { select: { name: true } },
          },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.bankDeposit.findMany({
          where: { bankAccountId: id, cityId: account.cityId },
          select: { id: true, depositDate: true, createdAt: true, cashAmount: true, slipNumber: true, notes: true, currencyId: true },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.payment.findMany({
          where: {
            bankDepositId: { not: null },
            paymentMethod: "cheque",
            status: "active",
            cityId: account.cityId,
            OR: [
              { bankAccountId: id },
              { bankDeposit: { bankAccountId: id } },
            ],
          },
          select: { id: true, paymentDate: true, createdAt: true, amount: true, chequeNumber: true, currencyId: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.expense.findMany({
          where: { bankAccountId: id, cityId: account.cityId, deletedAt: null },
          select: { id: true, expenseDate: true, createdAt: true, amount: true, detail: true, currencyId: true },
          orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.hajiTransfer.findMany({
          where: { bankAccountId: id, cityId: account.cityId, sourceType: "bank_transfer" },
          select: { id: true, transferDate: true, createdAt: true, amount: true, detail: true, currencyId: true },
          orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.supplierPayment.findMany({
          where: { bankAccountId: id, deletedAt: null },
          select: { id: true, paymentDate: true, createdAt: true, amountUsd: true, amountLocal: true, exchangeRate: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.shippingLinePayment.findMany({
          where: { bankAccountId: id, deletedAt: null },
          select: { id: true, paymentDate: true, createdAt: true, amountUsd: true, amountPkr: true, exchangeRate: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.agentPayment.findMany({
          where: { bankAccountId: id, deletedAt: null },
          select: { id: true, paymentDate: true, createdAt: true, amount: true, currencyCode: true, reference: true },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.lotCost.findMany({
          where: { bankAccountId: id },
          include: { lot: { select: { lotNumber: true } } },
          orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.intermediaryDeposit.findMany({
          where: { bankAccountId: id, deletedAt: null },
          include: { intermediary: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.superAdminLiabilityEntry.findMany({
          where: { bankAccountId: id, cityId: account.cityId, sourceType: "city_bank" },
          include: { account: { select: { name: true } }, currency: { select: { code: true } } },
          orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
        }),
      ]);

    const rows: LedgerRow[] = [];
    for (const p of paymentsIn) {
      const source = p.customer?.name || p.detail || "Customer";
      rows.push({
        key: `pay-${p.id}`,
        date: new Date(p.paymentDate),
        createdAt: new Date(p.createdAt),
        type: "Payment In",
        detail: withRef(`${source} — ${paymentMethodLabel(p.paymentMethod)}`, p.manualVoucherNo),
        reference: null,
        currencyCode: toCurrencyCode(p.currencyId, currencyCodeById),
        credit: Number(p.amount),
        debit: 0,
      });
    }
    for (const d of deposits) {
      const cash = Number(d.cashAmount || 0);
      const isWithdrawal = cash < 0;
      const isB2BOut = String(d.slipNumber || "").includes("[B2B-OUT]") || String(d.notes || "").includes("[B2B-OUT]");
      const isB2BIn = String(d.slipNumber || "").includes("[B2B-IN]") || String(d.notes || "").includes("[B2B-IN]");
      rows.push({
        key: `dep-${d.id}`,
        date: new Date(d.depositDate),
        createdAt: new Date(d.createdAt),
        type: isB2BOut || isB2BIn ? "Bank Transfer" : isWithdrawal ? "Bank Withdrawal" : "Bank Deposit",
        detail: withRef(isB2BOut ? "Transfer to another bank" : isB2BIn ? "Transfer from another bank" : isWithdrawal ? "Cash withdrawn to office" : "Cash deposit", d.slipNumber),
        reference: null,
        currencyCode: toCurrencyCode(d.currencyId, currencyCodeById),
        credit: cash > 0 ? cash : 0,
        debit: cash < 0 ? Math.abs(cash) : 0,
      });
    }
    for (const c of depositedCheques) {
      rows.push({
        key: `chq-${c.id}`,
        date: new Date(c.paymentDate),
        createdAt: new Date(c.createdAt),
        type: "Cheque Deposit",
        detail: withRef("Cheque deposit", c.chequeNumber),
        reference: null,
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
    for (const entry of liabilityEntries) {
      const sourceIncrease = Number(entry.liabilityEffect) > 0;
      rows.push({
        key: `saliab-${entry.id}`,
        date: new Date(entry.entryDate),
        createdAt: new Date(entry.createdAt),
        type: sourceIncrease ? "Liability Receipt/Reversal" : "Liability Payment",
        detail: entry.account.name,
        reference: entry.reference,
        currencyCode: entry.currency.code,
        credit: sourceIncrease ? Number(entry.amount) : 0,
        debit: sourceIncrease ? 0 : Number(entry.amount),
      });
    }

    return respondLedgerView(request.nextUrl.searchParams, {
      id: account.id,
      cityId: account.cityId,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      scope: "city",
    }, rows);
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
