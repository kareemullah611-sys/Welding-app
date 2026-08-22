export type HistoricalSaleProfitInput = {
  saleId: number | string;
  saleCurrencyCode: string;
  saleTotalAmount: unknown;
  saleFxPkrEquivalent?: unknown;
  itemAmount: unknown;
  itemQty: unknown;
  landedCostPerCartonPkr: unknown;
};

export type HistoricalSaleProfitResult = {
  ok: true;
  revenuePkr: number;
  cogsPkr: number;
  profitPkr: number;
  source: "PKR" | "FX_RECOGNITION_METADATA";
} | {
  ok: false;
  revenuePkr: number;
  cogsPkr: number;
  profitPkr: number;
  missingReason: string;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrencyCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "RMB" ? "CNY" : normalized;
}

export function calculateHistoricalSaleProfitPkr(input: HistoricalSaleProfitInput): HistoricalSaleProfitResult {
  const currencyCode = normalizeCurrencyCode(input.saleCurrencyCode);
  const itemAmount = num(input.itemAmount);
  const itemQty = num(input.itemQty);
  const cogsPkr = round2(itemQty * num(input.landedCostPerCartonPkr));
  if (currencyCode === "PKR") {
    const revenuePkr = round2(itemAmount);
    return { ok: true, revenuePkr, cogsPkr, profitPkr: round2(revenuePkr - cogsPkr), source: "PKR" };
  }

  const fxPkrEquivalent = num(input.saleFxPkrEquivalent);
  const saleTotalAmount = num(input.saleTotalAmount);
  if (fxPkrEquivalent <= 0 || saleTotalAmount <= 0) {
    return {
      ok: false,
      revenuePkr: 0,
      cogsPkr,
      profitPkr: 0,
      missingReason: `Sale ${input.saleId} ${currencyCode} revenue requires stored PKR FX recognition metadata before historical-pool attribution.`,
    };
  }

  const revenuePkr = round2((itemAmount / saleTotalAmount) * fxPkrEquivalent);
  return { ok: true, revenuePkr, cogsPkr, profitPkr: round2(revenuePkr - cogsPkr), source: "FX_RECOGNITION_METADATA" };
}
