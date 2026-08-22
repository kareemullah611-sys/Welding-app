import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalBankDeposit } from "@/lib/accounting";
import { getCityBankAccountAvailableBalance } from "@/lib/city-bank-balance";

const allowed = new Set(["cheque_to_bank", "bank_to_cash", "cheque_to_cash", "bank_to_bank"]);

async function clearDepositJournal(tx: any, id: number) {
  await tx.journalEntry.deleteMany({ where: { entityType: "bank_deposit", entityId: id } });
}

async function resolveBankToBankPair(db: any, row: any) {
  if (row.transferPairId) {
    const rows = await db.bankDeposit.findMany({ where: { transferPairId: row.transferPairId, transferType: "bank_to_bank" } });
    if (rows.length === 2) return rows;
    throw new Error("BANK_TRANSFER_PAIR_INVALID");
  }
  const amount = Math.abs(Number(row.cashAmount));
  const counterpart = await db.bankDeposit.findMany({
    where: {
      id: { not: row.id }, cityId: row.cityId, currencyId: row.currencyId,
      transferType: "bank_to_bank", depositDate: row.depositDate,
      slipNumber: row.slipNumber, cashAmount: Number(row.cashAmount) < 0 ? amount : -amount,
      notes: { contains: Number(row.cashAmount) < 0 ? "[B2B-IN]" : "[B2B-OUT]" },
    },
  });
  if (counterpart.length !== 1) throw new Error("BANK_TRANSFER_PAIR_AMBIGUOUS");
  return [row, counterpart[0]];
}

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const body = await request.json();
    const existing = await prisma.bankDeposit.findUnique({ where: { id }, include: { currency: true, cheques: true } });
    if (!existing) return errorResponse("NOT_FOUND", "Transfer not found", 404);
    if (user.role === "city_admin" && existing.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    const transferType = String(body.transferType || existing.transferType);
    if (!allowed.has(transferType)) return errorResponse("VALIDATION_ERROR", "Invalid transfer type");
    if ((existing.transferType === "bank_to_bank") !== (transferType === "bank_to_bank")) return errorResponse("VALIDATION_ERROR", "Bank-to-bank transfers cannot be converted to another type");
    if (transferType === "bank_to_bank") {
      const sourceBankAccountId = Number(body.bankAccountId || 0);
      const destinationBankAccountId = Number(body.destinationBankAccountId || 0);
      const amount = Math.abs(Number(body.cashAmount || 0));
      const currencyId = Number(body.currencyId || 0);
      const date = new Date(body.depositDate);
      if (!sourceBankAccountId || !destinationBankAccountId || sourceBankAccountId === destinationBankAccountId) return errorResponse("VALIDATION_ERROR", "Select different source and destination bank accounts");
      if (!(amount > 0) || !currencyId || Number.isNaN(date.getTime())) return errorResponse("VALIDATION_ERROR", "Valid amount, currency, and date are required");
      const accounts = await prisma.bankAccount.findMany({ where: { id: { in: [sourceBankAccountId, destinationBankAccountId] }, cityId: existing.cityId } });
      if (accounts.length !== 2) return errorResponse("FORBIDDEN", "Both bank accounts must belong to your city", 403);
      const currency = await prisma.currency.findUnique({ where: { id: currencyId }, select: { code: true } });
      if (!currency) return errorResponse("VALIDATION_ERROR", "Currency not found");
      const pair = await resolveBankToBankPair(prisma, existing);
      const oldSource = pair.find((row: any) => Number(row.cashAmount) < 0);
      const oldDestination = pair.find((row: any) => Number(row.cashAmount) > 0);
      if (!oldSource || !oldDestination) return errorResponse("VALIDATION_ERROR", "Bank transfer pair is invalid");
      const available = await getCityBankAccountAvailableBalance(prisma, { cityId: existing.cityId, bankAccountId: sourceBankAccountId, currencyId });
      const adjustedAvailable = available
        + (oldSource.bankAccountId === sourceBankAccountId && oldSource.currencyId === currencyId ? Math.abs(Number(oldSource.cashAmount)) : 0)
        - (oldDestination.bankAccountId === sourceBankAccountId && oldDestination.currencyId === currencyId ? Math.abs(Number(oldDestination.cashAmount)) : 0);
      if (amount > adjustedAvailable + 0.001) return errorResponse("INSUFFICIENT_FUNDS", `Insufficient bank balance. Available: ${adjustedAvailable.toLocaleString("en-US")} ${currency.code}`);
      const pairId = existing.transferPairId || crypto.randomUUID();
      const notes = body.notes ? String(body.notes).trim() : "";
      await prisma.$transaction(async (tx) => {
        await clearDepositJournal(tx, oldSource.id);
        await clearDepositJournal(tx, oldDestination.id);
        await tx.bankDeposit.update({ where: { id: oldSource.id }, data: { bankAccountId: sourceBankAccountId, transferPairId: pairId, depositDate: date, slipNumber: body.slipNumber || null, cashAmount: -amount, currencyId, notes: [notes, "[B2B-OUT]"].filter(Boolean).join(" ") } });
        await tx.bankDeposit.update({ where: { id: oldDestination.id }, data: { bankAccountId: destinationBankAccountId, transferPairId: pairId, depositDate: date, slipNumber: body.slipNumber || null, cashAmount: amount, currencyId, notes: [notes, "[B2B-IN]"].filter(Boolean).join(" ") } });
        await journalBankDeposit({ id: oldSource.id, bankAccountId: sourceBankAccountId, cityId: existing.cityId, cashAmount: -amount, currencyCode: currency.code, depositDate: date, createdBy: user.userId, transferType, transactionKeySuffix: "B2B-OUT", cheques: [] }, tx);
        await journalBankDeposit({ id: oldDestination.id, bankAccountId: destinationBankAccountId, cityId: existing.cityId, cashAmount: amount, currencyCode: currency.code, depositDate: date, createdBy: user.userId, transferType, transactionKeySuffix: "B2B-IN", cheques: [] }, tx);
      });
      await createAuditLog(user.userId, existing.cityId, "bank_deposits", oldSource.id, "update", { pairIds: pair.map((row: any) => row.id) }, body, getClientIP(request));
      return successResponse({ id: oldSource.id, destinationId: oldDestination.id }, "Bank transfer updated");
    }
    const bankAccountId = transferType === "cheque_to_cash" ? null : Number(body.bankAccountId || 0);
    if (transferType !== "cheque_to_cash" && !bankAccountId) return errorResponse("VALIDATION_ERROR", "bankAccountId is required");
    const chequeIds = Array.isArray(body.chequePaymentIds) ? body.chequePaymentIds.map(Number) : [];
    if (transferType === "cheque_to_cash" && chequeIds.length === 0) return errorResponse("VALIDATION_ERROR", "Select at least one cheque");
    const cheques = chequeIds.length ? await prisma.payment.findMany({ where: { id: { in: chequeIds }, cityId: existing.cityId, currencyId: Number(body.currencyId), paymentMethod: "cheque", destination: "our_account", status: "active", OR: [{ chequeStatus: "in_hand" }, { bankDepositId: id }] } }) : [];
    if (cheques.length !== chequeIds.length) return errorResponse("VALIDATION_ERROR", "One or more cheques are unavailable");
    const amount = transferType === "cheque_to_cash"
      ? -cheques.reduce((sum, cheque) => sum + Number(cheque.amount), 0)
      : transferType === "bank_to_cash" ? -Math.abs(Number(body.cashAmount || 0)) : Math.abs(Number(body.cashAmount || 0));
    const date = new Date(body.depositDate);
    if (Number.isNaN(date.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid date");
    const currency = await prisma.currency.findUnique({ where: { id: Number(body.currencyId) }, select: { code: true } });
    if (!currency) return errorResponse("VALIDATION_ERROR", "Currency not found");

    await prisma.$transaction(async (tx) => {
      await clearDepositJournal(tx, id);
      await tx.payment.updateMany({ where: { bankDepositId: id }, data: { bankDepositId: null, bankAccountId: null, chequeStatus: "in_hand" } });
      const updatedCheques = await tx.payment.updateMany({ where: { id: { in: chequeIds }, chequeStatus: "in_hand" }, data: { bankDepositId: id, bankAccountId, chequeStatus: "deposited_to_bank" } });
      if (updatedCheques.count !== chequeIds.length) throw new Error("One or more cheques were used by another transfer");
      await tx.bankDeposit.update({ where: { id }, data: { transferType, bankAccountId, depositDate: date, slipNumber: body.slipNumber || null, cashAmount: amount, currencyId: Number(body.currencyId), notes: body.notes || null } });
      await journalBankDeposit({ id, bankAccountId, cityId: existing.cityId, cashAmount: amount, currencyCode: currency.code, depositDate: date, createdBy: user.userId, transferType, cheques: cheques.map((c) => ({ paymentId: c.id, amount: Number(c.amount) })) }, tx);
    });
    await createAuditLog(user.userId, existing.cityId, "bank_deposits", id, "update", undefined, body, getClientIP(request));
    return successResponse({ id }, "Transfer updated");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BANK_TRANSFER_PAIR_")) return errorResponse("VALIDATION_ERROR", "Historical bank transfer pair is missing or ambiguous");
    return serverError();
  }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const existing = await prisma.bankDeposit.findUnique({ where: { id }, include: { cheques: true } });
    if (!existing) return errorResponse("NOT_FOUND", "Transfer not found", 404);
    if (user.role === "city_admin" && existing.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if (existing.transferType === "bank_to_bank") {
      const pair = await resolveBankToBankPair(prisma, existing);
      const pairIds = pair.map((row: any) => row.id);
      await prisma.$transaction(async (tx) => {
        for (const pairId of pairIds) await clearDepositJournal(tx, pairId);
        await tx.bankDeposit.deleteMany({ where: { id: { in: pairIds } } });
      });
      await createAuditLog(user.userId, existing.cityId, "bank_deposits", id, "delete", { pairIds }, undefined, getClientIP(request));
      return successResponse({ ids: pairIds }, "Bank transfer deleted");
    }
    await prisma.$transaction(async (tx) => {
      await clearDepositJournal(tx, id);
      await tx.payment.updateMany({ where: { bankDepositId: id }, data: { bankDepositId: null, bankAccountId: null, chequeStatus: "in_hand" } });
      await tx.bankDeposit.delete({ where: { id } });
    });
    await createAuditLog(user.userId, existing.cityId, "bank_deposits", id, "delete", existing, undefined, getClientIP(request));
    return successResponse({ id }, "Transfer deleted");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BANK_TRANSFER_PAIR_")) return errorResponse("VALIDATION_ERROR", "Historical bank transfer pair is missing or ambiguous");
    return serverError();
  }
});
