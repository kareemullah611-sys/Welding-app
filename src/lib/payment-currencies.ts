/** Settlement currencies supported for super-admin outbound payments (rate captured to PKR). */
export const SETTLEMENT_CURRENCY_CODES = ["USD", "AFN", "PKR", "CNY"] as const;

export type SettlementCurrencyCode = (typeof SETTLEMENT_CURRENCY_CODES)[number];

export function settlementAmountToPkr(amount: number, currencyCode: string, rateToPkr: number): number {
  const code = String(currencyCode || "USD").toUpperCase();
  if (!amount) return 0;
  if (code === "PKR") return amount;
  return rateToPkr > 0 ? amount * rateToPkr : 0;
}
