import type { Prisma } from "@prisma/client";
import {
  journalForeignCarryingTransfers,
  journalHajiTransfer,
  reverseJournalEntries,
} from "@/lib/accounting";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import {
  foreignCurrencyOwnerKey,
  reverseForeignCurrencyMovements,
  transferForeignCurrencyLayers,
} from "@/lib/foreign-currency-carrying-db";

type DbClient = Prisma.TransactionClient;

function journalInputFromTransfer(transfer: any, createdBy: number) {
  return {
    id: transfer.id,
    cityId: transfer.cityId,
    lotId: transfer.lotId,
    amount: Number(transfer.amount),
    currencyCode: transfer.currency.code,
    date: transfer.transferDate,
    createdBy,
    sourceType: transfer.sourceType ?? null,
    bankAccountId: transfer.bankAccountId ?? null,
    settlementDestination: transfer.settlementDestination ?? "standard",
    intermediaryId: transfer.intermediaryId ?? null,
    superAdminCashAccountId: transfer.superAdminCashAccountId ?? null,
    superAdminBankAccountId: transfer.superAdminBankAccountId ?? null,
  };
}

export async function recordHajiTransferAccounting(
  tx: DbClient,
  transfer: any,
  createdBy: number,
) {
  if (!isSupportedForeignCurrency(transfer.currency.code)) {
    await journalHajiTransfer(journalInputFromTransfer(transfer, createdBy), tx);
    return;
  }

  const target = transfer.intermediaryId
    ? {
        ownerKey: foreignCurrencyOwnerKey.intermediary(transfer.intermediaryId),
        positionType: "intermediary_balance" as const,
      }
    : transfer.superAdminCashAccountId
      ? {
          ownerKey: foreignCurrencyOwnerKey.superAdminCash(transfer.superAdminCashAccountId),
          positionType: "super_admin_cash" as const,
        }
      : transfer.superAdminBankAccountId
        ? {
            ownerKey: foreignCurrencyOwnerKey.superAdminBank(transfer.superAdminBankAccountId),
            positionType: "super_admin_bank" as const,
          }
        : {
            ownerKey: foreignCurrencyOwnerKey.haji(transfer.cityId),
            positionType: "other_receivable" as const,
          };
  const sourceOwnerKey = transfer.sourceType === "bank_transfer" && transfer.bankAccountId
    ? foreignCurrencyOwnerKey.cityBank(transfer.bankAccountId)
    : transfer.sourceType === "cheque"
      ? foreignCurrencyOwnerKey.cityCheque(transfer.cityId)
      : foreignCurrencyOwnerKey.cityCash(transfer.cityId);

  const carryingTransfer = await transferForeignCurrencyLayers(tx, {
    sourceOwnerKey,
    targetOwnerKey: target.ownerKey,
    targetPositionType: target.positionType,
    currencyCode: transfer.currency.code,
    amount: Number(transfer.amount),
    sourceType: "haji_transfer",
    sourceId: transfer.id,
    movementDate: transfer.transferDate,
    createdBy,
  });
  await journalForeignCarryingTransfers({
    transferId: transfer.id,
    cityId: transfer.cityId,
    lotId: transfer.lotId,
    transferDate: transfer.transferDate,
    createdBy,
    movements: carryingTransfer.movements,
    intermediaryId: transfer.intermediaryId,
    superAdminCashAccountId: transfer.superAdminCashAccountId,
    superAdminBankAccountId: transfer.superAdminBankAccountId,
    bankAccountId: transfer.bankAccountId,
    sourceType: transfer.sourceType,
  }, tx);
}

export async function reverseHajiTransferAccounting(
  tx: DbClient,
  transfer: any,
  createdBy: number,
  mode: "edit" | "delete",
) {
  if (isSupportedForeignCurrency(transfer.currency.code)) {
    const reversed = await reverseForeignCurrencyMovements(tx, {
      sourceType: "haji_transfer",
      sourceId: transfer.id,
      reversalDate: new Date(),
      createdBy,
    });
    for (const journalTransactionId of reversed.journalTransactionIds) {
      await reverseJournalEntries(journalTransactionId, createdBy, tx);
    }
    return;
  }

  if (mode === "edit") {
    await tx.journalEntry.deleteMany({
      where: { transactionId: { in: [`HAJI-${transfer.id}`, `REV-HAJI-${transfer.id}`] } },
    });
    return;
  }
  await reverseJournalEntries(`HAJI-${transfer.id}`, createdBy, tx);
}
