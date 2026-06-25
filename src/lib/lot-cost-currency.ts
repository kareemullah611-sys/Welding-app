/** Currency rules for lot costs (non-purchase charges). */

export const FREIGHT_CURRENCIES = ["USD", "CNY"] as const;
export const AFG_NON_FREIGHT_CURRENCIES = ["USD", "CNY", "AFN", "PKR"] as const;
export const PK_NON_FREIGHT_CURRENCIES = ["PKR"] as const;
export const FOREIGN_TO_PKR = ["USD", "CNY", "AFN"] as const;

export type LotCostCurrencyCode = "USD" | "CNY" | "AFN" | "PKR";

export function normalizeCurrencyCode(value: unknown): LotCostCurrencyCode | null {
  const code = String(value || "").toUpperCase();
  if (code === "USD" || code === "CNY" || code === "AFN" || code === "PKR") return code;
  return null;
}

export function requiresAcquisitionRateToPkr(currencyCode: string): boolean {
  return (FOREIGN_TO_PKR as readonly string[]).includes(String(currencyCode || "").toUpperCase());
}

export function resolveLotCostCurrency(args: {
  isFreight: boolean;
  lotCountryCode: string;
  requestedCurrency?: string | null;
}): { ok: true; currencyCode: LotCostCurrencyCode } | { ok: false; message: string } {
  const country = String(args.lotCountryCode || "").toUpperCase();
  const isAfg = country === "AFG";

  if (args.isFreight) {
    const code = normalizeCurrencyCode(args.requestedCurrency || "USD");
    if (!code || !(FREIGHT_CURRENCIES as readonly string[]).includes(code)) {
      return { ok: false, message: "Freight must be recorded in USD or CNY" };
    }
    return { ok: true, currencyCode: code };
  }

  const allowed = isAfg ? AFG_NON_FREIGHT_CURRENCIES : PK_NON_FREIGHT_CURRENCIES;
  const code = normalizeCurrencyCode(args.requestedCurrency || (isAfg ? "AFN" : "PKR"));
  if (!code || !(allowed as readonly string[]).includes(code)) {
    const label = isAfg ? "USD, CNY, AFN, or PKR" : "PKR";
    return { ok: false, message: `Non-freight costs for this lot must be in ${label}` };
  }
  return { ok: true, currencyCode: code };
}

export function resolveLotCostExchangeRate(args: {
  currencyCode: LotCostCurrencyCode;
  exchangeRate?: unknown;
}): { ok: true; exchangeRate: number | null } | { ok: false; message: string } {
  if (!requiresAcquisitionRateToPkr(args.currencyCode)) {
    return { ok: true, exchangeRate: null };
  }
  const rate = Number(args.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, message: `Acquisition rate (${args.currencyCode}→PKR) is required` };
  }
  return { ok: true, exchangeRate: rate };
}
