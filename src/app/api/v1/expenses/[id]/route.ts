import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { journalExpenseCreated, journalForeignCustomerReceiptMovements, journalForeignExpenseMovements, journalPaymentReceived, reverseJournalEntries } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { updateExpenseSchema } from "@/lib/validations";
import { getSaCheckAuditStateMap, isSaCheckConfirmed } from "@/lib/sa-check-audit";
import { isAfghanistanCountry } from "@/lib/country-code";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import {
  foreignCurrencyOwnerKey,
  reverseForeignCurrencyMovements,
  settleForeignCurrencyAsset,
  settleForeignCurrencyOutflow,
} from "@/lib/foreign-currency-carrying-db";
import { resolveAfghanistanFxRateFromDb } from "@/lib/sarafi-af-snapshot-db";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        lot: { select: { lotNumber: true } },
        currency: true,
        customerPayment: { include: { customer: { select: { id: true, name: true } } } },
      } as any,
    });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    return successResponse({
      id: expense.id, expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount), detail: expense.detail, notes: expense.notes,
      paidFrom: (expense as any).paidFrom ?? "cash_office",
      bankAccountId: (expense as any).bankAccountId ?? null,
      chequePaymentId: (expense as any).chequePaymentId ?? null,
      customerPaymentId: (expense as any).customerPaymentId ?? null,
      customerPayment: (expense as any).customerPayment ?? null,
      lotNumber: (expense as any).lot?.lotNumber ?? null, currency: (expense as any).currency.code,
    });
  } catch (error) { return serverError(); }
});

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (body?.action !== "set_sa_check") return errorResponse("VALIDATION_ERROR", "Invalid expense action", 400);

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can verify expenses", 403);

    const confirmed = !!body.confirmed;
    const stateById = await getSaCheckAuditStateMap("expenses", [expense.id]);
    const current = stateById[expense.id] || null;
    if ((current?.confirmed || false) === confirmed) {
      return successResponse({
        confirmed,
        confirmedAt: current?.confirmedAt || null,
        confirmedBy: current?.confirmedBy || null,
      }, confirmed ? "Expense was already verified" : "Expense was already unverified");
    }

    await createAuditLog(
      user.userId,
      expense.cityId,
      "expenses",
      expense.id,
      "update",
      {
        saCheckConfirmed: current?.confirmed || false,
        saCheckConfirmedAt: current?.confirmedAt || null,
        saCheckConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
      },
      {
        saCheckConfirmed: confirmed,
        saCheckNote: confirmed ? "Super admin verified expense" : "Super admin removed expense verification",
      },
      getClientIP(request)
    );

    return successResponse({
      confirmed,
      confirmedAt: new Date().toISOString(),
      confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
    }, confirmed ? "Expense verified" : "Expense verification removed");
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid expense update", 400, parsed.error.errors);
    const data = parsed.data;
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        currency: true,
        city: { include: { country: true } },
        customerPayment: { include: { customer: { select: { id: true, name: true } } } },
      },
    } as any);
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if (await isSaCheckConfirmed("expenses", expense.id)) {
      return errorResponse("FORBIDDEN", "Cannot edit an expense after super admin verification", 403);
    }

    const nextPaidFrom = data.paidFrom ?? ((expense as any).paidFrom ?? "cash_office");
    const nextCustomerId = nextPaidFrom === "customer"
      ? (data.customerId ?? ((expense as any).customerPayment?.customerId ?? null))
      : null;
    const nextBankAccountId = nextPaidFrom === "bank_account"
      ? (data.bankAccountId ?? ((expense as any).bankAccountId ?? null))
      : null;
    const nextChequePaymentId = nextPaidFrom === "cheque"
      ? (data.chequePaymentId ?? ((expense as any).chequePaymentId ?? null))
      : null;
    const nextExpenseDate = data.expenseDate ? new Date(data.expenseDate) : expense.expenseDate;
    if (Number.isNaN(nextExpenseDate.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid expense date");
    const foreignExpenseRate = isAfghanistanCountry((expense as any).city.country) && isSupportedForeignCurrency((expense as any).currency.code)
      ? await resolveAfghanistanFxRateFromDb({
          currencyCode: (expense as any).currency.code,
          transactionDate: nextExpenseDate,
          purpose: "settlement",
          positionKind: "asset",
        })
      : null;
    if (foreignExpenseRate && !foreignExpenseRate.ok) {
      return errorResponse("FX_RATE_REQUIRED", foreignExpenseRate.missingReason, 400);
    }

    if ((expense as any).paidFrom === "cheque") {
      const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(expense.amount);
      const sourceChanged = nextPaidFrom !== "cheque" || nextChequePaymentId !== ((expense as any).chequePaymentId ?? null);
      if (amountChanged || sourceChanged) {
        return errorResponse("VALIDATION_ERROR", "Cannot change amount or source for an expense that was paid from a cheque");
      }
    }
    if (nextPaidFrom === "customer" && !nextCustomerId) {
      return errorResponse("VALIDATION_ERROR", "Customer is required when source is customer");
    }
    if (nextPaidFrom === "bank_account" && !nextBankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account is required when source is bank account");
    }
    if (nextPaidFrom === "cheque" && !nextChequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque is required when source is cheque");
    }
    if (nextPaidFrom === "bank_account" && nextBankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!bankAccount || !bankAccount.isActive) return errorResponse("NOT_FOUND", "Selected bank account not found", 404);
      if (bankAccount.cityId !== expense.cityId) return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
    }
    if (nextPaidFrom === "customer" && nextCustomerId) {
      const customer = await prisma.customer.findFirst({ where: { id: nextCustomerId, cityId: expense.cityId, isActive: true } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city", 404);
    }

    let customerPaymentFifoLotId: number | null = (expense as any).customerPayment?.lotId ?? null;
    if (nextPaidFrom === "customer" && nextCustomerId && !customerPaymentFifoLotId) {
      const fifoLot = await prisma.lot.findFirst({
        where: { status: "ongoing", lotCityDistributions: { some: { cityId: expense.cityId } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      customerPaymentFifoLotId = fifoLot?.id ?? null;
    }

    const old = {
      date: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount),
      detail: expense.detail,
      lotId: expense.lotId,
      paidFrom: (expense as any).paidFrom ?? "cash_office",
      bankAccountId: (expense as any).bankAccountId ?? null,
    };

    await prisma.$transaction(async (tx) => {
      if (foreignExpenseRate?.ok) {
        const reversedExpense = await reverseForeignCurrencyMovements(tx, {
          sourceType: "expense", sourceId: id, reversalDate: new Date(), createdBy: user.userId,
        });
        for (const journalTransactionId of reversedExpense.journalTransactionIds) {
          await reverseJournalEntries(journalTransactionId, user.userId, tx);
        }
      } else {
        await tx.journalEntry.deleteMany({
          where: { transactionId: { in: [`EXP-${id}`, `REV-EXP-${id}`] } },
        });
      }

      let nextCustomerPaymentId: number | null = null;
      const linkedCustomerPayment = (expense as any).customerPayment;
      if (linkedCustomerPayment) {
        if (foreignExpenseRate?.ok) {
          const reversedReceipt = await reverseForeignCurrencyMovements(tx, {
            sourceType: "expense_customer_payment", sourceId: linkedCustomerPayment.id, reversalDate: new Date(), createdBy: user.userId,
          });
          for (const journalTransactionId of reversedReceipt.journalTransactionIds) {
            await reverseJournalEntries(journalTransactionId, user.userId, tx);
          }
        } else {
          await tx.journalEntry.deleteMany({
            where: { transactionId: { in: [`PAY-${linkedCustomerPayment.id}`, `REV-PAY-${linkedCustomerPayment.id}`] } },
          });
        }
      }
      if (nextPaidFrom === "customer" && nextCustomerId) {
        if (linkedCustomerPayment && linkedCustomerPayment.status !== "active") {
          throw new Error("CUSTOMER_PAYMENT_LOCKED");
        }
        const paymentData = {
          cityId: expense.cityId,
          customerId: nextCustomerId,
          lotId: customerPaymentFifoLotId,
          paymentDate: nextExpenseDate,
          amount: data.amount ?? expense.amount,
          currencyId: expense.currencyId,
          detail: "cash- expense",
          paymentMethod: "cash",
          destination: "our_account",
          chequeNumber: null,
          chequeBank: null,
          chequeDueDate: null,
          chequeStatus: null,
          bankAccountId: null,
          superAdminBankAccountId: null,
          notes: data.notes !== undefined ? data.notes : expense.notes,
          updatedAt: new Date(),
        } as any;
        const payment = linkedCustomerPayment
          ? await tx.payment.update({ where: { id: linkedCustomerPayment.id }, data: paymentData })
          : await tx.payment.create({ data: { ...paymentData, createdBy: user.userId } });
        nextCustomerPaymentId = payment.id;
        if (foreignExpenseRate?.ok) {
          const receipt = await settleForeignCurrencyAsset(tx, {
            sourceOwnerKey: foreignCurrencyOwnerKey.customerReceivable(nextCustomerId),
            targetOwnerKey: foreignCurrencyOwnerKey.cityCash(expense.cityId),
            targetPositionType: "city_cash",
            currencyCode: (expense as any).currency.code,
            amount: Number(payment.amount),
            sourceType: "expense_customer_payment",
            sourceId: payment.id,
            settlementDate: payment.paymentDate,
            settlementRate: {
              ratePkr: foreignExpenseRate.rate, rateType: foreignExpenseRate.selectedRateType,
              provider: foreignExpenseRate.provider, reference: foreignExpenseRate.providerReference,
              conversionPath: foreignExpenseRate.conversionPath,
            },
            createdBy: user.userId,
          });
          await journalForeignCustomerReceiptMovements({
            paymentId: payment.id, customerId: nextCustomerId, cityId: expense.cityId,
            lotId: customerPaymentFifoLotId, paymentDate: payment.paymentDate,
            createdBy: user.userId, movements: receipt.movements,
          }, tx);
        } else {
          await journalPaymentReceived({
            id: payment.id,
            customerId: nextCustomerId,
            cityId: expense.cityId,
            lotId: customerPaymentFifoLotId,
            amount: Number(payment.amount),
            currencyCode: (expense as any).currency.code,
            paymentDate: payment.paymentDate,
            createdBy: user.userId,
            destination: "our_account",
            paymentMethod: "cash",
          }, tx);
        }
      } else if (linkedCustomerPayment) {
        await tx.payment.delete({ where: { id: linkedCustomerPayment.id } });
      }

      const next = await tx.expense.update({
        where: { id },
        data: {
          lotId: null,
          expenseDate: nextExpenseDate,
          amount: data.amount ?? expense.amount,
          detail: data.detail || expense.detail,
          paidFrom: nextPaidFrom,
          bankAccountId: nextBankAccountId,
          chequePaymentId: nextChequePaymentId,
          customerPaymentId: nextCustomerPaymentId,
          notes: data.notes !== undefined ? data.notes : expense.notes,
          updatedAt: new Date(),
        } as any,
      });

      if (foreignExpenseRate?.ok) {
        const outflow = await settleForeignCurrencyOutflow(tx, {
          sourceOwnerKey: foreignCurrencyOwnerKey.cityCash(expense.cityId),
          currencyCode: (expense as any).currency.code,
          amount: Number(next.amount), sourceType: "expense", sourceId: id,
          settlementDate: next.expenseDate,
          settlementRate: {
            ratePkr: foreignExpenseRate.rate, rateType: foreignExpenseRate.selectedRateType,
            provider: foreignExpenseRate.provider, reference: foreignExpenseRate.providerReference,
            conversionPath: foreignExpenseRate.conversionPath,
          },
          createdBy: user.userId,
        });
        await journalForeignExpenseMovements({
          expenseId: id, cityId: expense.cityId, expenseDate: next.expenseDate,
          detail: next.detail, createdBy: user.userId, paidFrom: "cash_office", movements: outflow.movements,
        }, tx);
      } else {
        await journalExpenseCreated({
          id,
          cityId: expense.cityId,
          lotId: null,
          amount: Number(next.amount),
          currencyCode: (expense as any).currency.code,
          detail: next.detail,
          expenseDate: next.expenseDate,
          createdBy: user.userId,
          paidFrom: nextPaidFrom,
          bankAccountId: nextBankAccountId,
        }, tx);
      }

      await createAuditLog(
        user.userId,
        expense.cityId,
        "expenses",
        id,
        "update",
        old,
        {
          date: next.expenseDate.toISOString().split("T")[0],
          amount: Number(next.amount),
          detail: next.detail,
          lotId: null,
          paidFrom: nextPaidFrom,
          bankAccountId: nextBankAccountId,
        },
        getClientIP(request),
        tx
      );

    });

    return successResponse({ id }, "Expense updated");
  } catch (error: any) {
    if (error?.message === "CUSTOMER_PAYMENT_LOCKED") return errorResponse("VALIDATION_ERROR", "Linked customer payment can no longer be edited");
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: { currency: true, city: { include: { country: true } }, customerPayment: true } as any,
    });
    if (!expense || expense.deletedAt !== null) return errorResponse("NOT_FOUND", "Expense not found", 404);
    if (user.role === "city_admin" && expense.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.$transaction(async (tx) => {
      const tracesForeign = isAfghanistanCountry((expense as any).city.country) && isSupportedForeignCurrency((expense as any).currency.code);
      if (tracesForeign) {
        const reversedExpense = await reverseForeignCurrencyMovements(tx, {
          sourceType: "expense", sourceId: id, reversalDate: new Date(), createdBy: user.userId,
        });
        for (const journalTransactionId of reversedExpense.journalTransactionIds) {
          await reverseJournalEntries(journalTransactionId, user.userId, tx);
        }
      } else {
        await reverseJournalEntries(`EXP-${id}`, user.userId, tx);
      }
      const linkedCustomerPayment = (expense as any).customerPayment;
      if (linkedCustomerPayment) {
        if (tracesForeign) {
          const reversedReceipt = await reverseForeignCurrencyMovements(tx, {
            sourceType: "expense_customer_payment", sourceId: linkedCustomerPayment.id,
            reversalDate: new Date(), createdBy: user.userId,
          });
          for (const journalTransactionId of reversedReceipt.journalTransactionIds) {
            await reverseJournalEntries(journalTransactionId, user.userId, tx);
          }
        } else {
          await tx.journalEntry.deleteMany({
            where: { transactionId: { in: [`PAY-${linkedCustomerPayment.id}`, `REV-PAY-${linkedCustomerPayment.id}`] } },
          });
        }
        await tx.payment.delete({ where: { id: linkedCustomerPayment.id } });
      }

      if ((expense as any).chequePaymentId) {
        await tx.payment.update({
          where: { id: (expense as any).chequePaymentId },
          data: { chequeStatus: "in_hand" } as any,
        });
      }

      await tx.expense.update({ where: { id }, data: { deletedAt: new Date() } });

      await createAuditLog(
        user.userId,
        expense.cityId,
        "expenses",
        id,
        "delete",
        { amount: Number(expense.amount), detail: expense.detail },
        undefined,
        getClientIP(request),
        tx
      );
    });

    return successResponse({ id }, "Expense deleted");
  } catch (error) { return serverError(); }
});
