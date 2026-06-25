import { formatNumber } from "@/components/ui";

type MoneyUser =
  | {
      role?: string;
      countryName?: string | null;
      currencies?: { code: string }[];
    }
  | null
  | undefined;

// A Pakistan city admin (or any city admin with a single currency) operates in
// one currency, so showing the "PKR" code on every figure is noise. Super admins
// always keep currency codes because they compare across countries.
export function isSingleCurrencyCityAdmin(user: MoneyUser): boolean {
  if (user?.role !== "city_admin") return false;
  if (user?.countryName === "Pakistan") return true;
  const codes = new Set((user?.currencies || []).map((c) => c.code));
  return codes.size <= 1;
}

// Format a single amount, hiding the currency code for single-currency city admins.
export function formatCityAmount(
  user: MoneyUser,
  amount: number | null | undefined,
  currencyCode?: string
): string {
  if (isSingleCurrencyCityAdmin(user) || !currencyCode) {
    return formatNumber(amount);
  }
  return `${currencyCode} ${formatNumber(amount)}`;
}

// Format a currency-keyed pot map ({ PKR: 100, USD: 5 }).
// Single-currency city admins see just the number; everyone else sees codes.
export function formatCityPot(
  user: MoneyUser,
  pot: Record<string, number> | undefined | null
): string {
  const entries = Object.entries(pot || {}).filter(([, v]) => Number(v) !== 0);
  if (entries.length === 0) return "0";
  // A single currency never needs a code label; multi-currency keeps codes so
  // figures stay unambiguous (e.g. Afghanistan cities holding AFN + USD).
  if (entries.length === 1) return formatNumber(entries[0][1]);
  if (isSingleCurrencyCityAdmin(user)) {
    return entries.map(([, amt]) => formatNumber(amt)).join(" · ");
  }
  return entries.map(([cc, amt]) => `${cc} ${formatNumber(amt)}`).join(" · ");
}

export function formatCurrencySelectLabel(currency: { code?: string; symbol?: string | null }): string {
  const code = String(currency.code || "").trim();
  const symbol = String(currency.symbol || "").trim();
  if (!symbol || symbol === code) return code || "—";
  return `${code} (${symbol})`;
}

export function ledgerCurrencyLabel(symbol?: string | null, code?: string | null): string {
  return String(symbol || code || "").trim();
}

export function formatLedgerMoneyAmount(
  amount: number | null | undefined,
  symbol?: string | null,
  code?: string | null,
): string {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) === 0) return "";
  const label = ledgerCurrencyLabel(symbol, code);
  const formatted = formatNumber(amount);
  return label ? `${label} ${formatted}` : formatted;
}
