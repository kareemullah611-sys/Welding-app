function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizePaymentFx(input: {
  amount: number;
  currencyCode: string;
  exchangeRate?: number | null;
}) {
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (currencyCode === "USD") {
    return { exchangeRate: null, usdEquivalent: roundCurrency(input.amount) };
  }
  if (currencyCode !== "AFN" || input.exchangeRate == null) {
    return { exchangeRate: null, usdEquivalent: null };
  }
  const exchangeRate = Number(input.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("AFN_USD_RATE_INVALID");
  }
  return {
    exchangeRate,
    usdEquivalent: roundCurrency(input.amount / exchangeRate),
  };
}
