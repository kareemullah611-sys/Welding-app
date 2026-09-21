import type { Prisma } from "@prisma/client";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import { foreignCurrencyOwnerKey, transferForeignCurrencyLayers } from "@/lib/foreign-currency-carrying-db";

type DbClient = Prisma.TransactionClient;

export async function applyForeignCityTreasuryTransfer(db: DbClient, input: {
  depositId: number;
  transferType: "cheque_to_bank" | "bank_to_cash" | "cheque_to_cash" | "bank_to_bank";
  cityId: number;
  bankAccountId?: number | null;
  destinationBankAccountId?: number | null;
  currencyCode: string;
  cashAmount: number;
  chequeAmount: number;
  movementDate: Date;
  createdBy: number;
}) {
  if (!isSupportedForeignCurrency(input.currencyCode)) return [];
  const movements: Array<{ id: number }> = [];
  const move = async (sourceOwnerKey: string, targetOwnerKey: string, targetPositionType: "city_cash" | "city_bank", amount: number) => {
    if (!(amount > 0)) return;
    const result = await transferForeignCurrencyLayers(db, {
      sourceOwnerKey,
      targetOwnerKey,
      targetPositionType,
      currencyCode: input.currencyCode,
      amount,
      sourceType: "bank_deposit",
      sourceId: input.depositId,
      movementDate: input.movementDate,
      createdBy: input.createdBy,
    });
    movements.push(...result.movements);
  };
  if (input.transferType === "cheque_to_bank") {
    if (!input.bankAccountId) throw new Error("A destination bank account is required for a foreign cheque deposit.");
    await move(foreignCurrencyOwnerKey.cityCheque(input.cityId), foreignCurrencyOwnerKey.cityBank(input.bankAccountId), "city_bank", input.chequeAmount);
    await move(foreignCurrencyOwnerKey.cityCash(input.cityId), foreignCurrencyOwnerKey.cityBank(input.bankAccountId), "city_bank", Math.max(0, input.cashAmount));
  } else if (input.transferType === "cheque_to_cash") {
    await move(foreignCurrencyOwnerKey.cityCheque(input.cityId), foreignCurrencyOwnerKey.cityCash(input.cityId), "city_cash", input.chequeAmount);
  } else if (input.transferType === "bank_to_cash") {
    if (!input.bankAccountId) throw new Error("A source bank account is required for a foreign bank-to-cash transfer.");
    await move(foreignCurrencyOwnerKey.cityBank(input.bankAccountId), foreignCurrencyOwnerKey.cityCash(input.cityId), "city_cash", Math.abs(input.cashAmount));
  } else {
    if (!input.bankAccountId || !input.destinationBankAccountId) throw new Error("Source and destination bank accounts are required for a foreign bank transfer.");
    await move(foreignCurrencyOwnerKey.cityBank(input.bankAccountId), foreignCurrencyOwnerKey.cityBank(input.destinationBankAccountId), "city_bank", Math.abs(input.cashAmount));
  }
  return movements;
}
