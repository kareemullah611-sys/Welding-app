/** PKR-normalized landed cost — shared by Lots page, profit-report API, and COGS journals. */

export type LotCostLike = {
  amount?: unknown;
  currencyCode?: string | null;
  exchangeRate?: unknown;
  costType?: string | null;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class MissingLandedCostFxRateError extends Error {
  constructor(currencyCode: string) {
    super(`Missing ${currencyCode} to PKR exchange rate for landed cost`);
    this.name = "MissingLandedCostFxRateError";
  }
}

/** Convert a lot-cost row to PKR using stored rates and the lot USD/PKR rate. */
export function lotCostToPkr(cost: LotCostLike, usdPkrRate: number): number {
  const amount = num(cost?.amount);
  if (!amount) return 0;

  const code = String(cost?.currencyCode || "PKR").toUpperCase();
  if (code === "PKR") return amount;
  if (code === "AFN" || code === "CNY") {
    const toPkr = num(cost?.exchangeRate);
    if (toPkr <= 0) throw new MissingLandedCostFxRateError(code);
    return amount * toPkr;
  }
  if (code === "USD") {
    const rate = num(cost?.exchangeRate) > 0 ? num(cost.exchangeRate) : usdPkrRate;
    if (rate <= 0) throw new MissingLandedCostFxRateError(code);
    return amount * rate;
  }

  const legacyRate = num(cost?.exchangeRate);
  if (legacyRate <= 0 || usdPkrRate <= 0) throw new MissingLandedCostFxRateError(code);
  return (amount / legacyRate) * usdPkrRate;
}

export function resolveAfnToPkrRate(costs: LotCostLike[]): number {
  const row = costs.find(
    (c) => String(c.currencyCode || "").toUpperCase() === "AFN" && num(c.exchangeRate) > 0
  );
  return row ? num(row.exchangeRate) : 0;
}

export function resolveCnyToPkrRate(costs: LotCostLike[]): number {
  const row = costs.find(
    (c) => String(c.currencyCode || "").toUpperCase() === "CNY" && num(c.exchangeRate) > 0
  );
  return row ? num(row.exchangeRate) : 0;
}

/** Sum city-admin lot expenses (grouped by currency code) into PKR. */
export function lotExpensesByCurrencyToPkr(
  byCurrency: Record<string, number>,
  usdPkrRate: number,
  afnToPkrRate: number,
  cnyToPkrRate = 0
): number {
  let total = num(byCurrency.PKR);
  if (num(byCurrency.USD) > 0) {
    if (usdPkrRate <= 0) throw new MissingLandedCostFxRateError("USD");
    total += num(byCurrency.USD) * usdPkrRate;
  }
  if (num(byCurrency.AFN) > 0) {
    if (afnToPkrRate <= 0) throw new MissingLandedCostFxRateError("AFN");
    total += num(byCurrency.AFN) * afnToPkrRate;
  }
  if (num(byCurrency.CNY) > 0) {
    if (cnyToPkrRate <= 0) throw new MissingLandedCostFxRateError("CNY");
    total += num(byCurrency.CNY) * cnyToPkrRate;
  }
  return total;
}

export function groupExpensesByCurrency(
  expenses: Array<{ amount?: unknown; currency?: { code?: string | null } | null }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) {
    const code = String(e.currency?.code || "PKR").toUpperCase();
    out[code] = (out[code] || 0) + num(e.amount);
  }
  return out;
}

export type LotLandedCostPkrInput = {
  totalPurchaseUsd: number;
  totalCartons: number;
  lotCosts: LotCostLike[];
  lotExpensesByCurrency?: Record<string, number>;
  usdPkrRate: number;
};

export type LotLandedCostPkrResult = {
  totalLandedCostPkr: number;
  landedCostPerCartonPkr: number;
  purchasePkr: number;
  freightPkr: number;
  nonFreightCostsPkr: number;
  lotExpensesPkr: number;
  afnToPkrRate: number;
  cnyToPkrRate: number;
};

/** Matches the PKR profit snapshot on the Lots page. */
export function computeLotLandedCostPkr(input: LotLandedCostPkrInput): LotLandedCostPkrResult {
  const rate = num(input.usdPkrRate);
  const empty: LotLandedCostPkrResult = {
    totalLandedCostPkr: 0,
    landedCostPerCartonPkr: 0,
    purchasePkr: 0,
    freightPkr: 0,
    nonFreightCostsPkr: 0,
    lotExpensesPkr: 0,
    afnToPkrRate: 0,
    cnyToPkrRate: 0,
  };
  const purchaseUsd = num(input.totalPurchaseUsd);
  if (rate <= 0 && purchaseUsd > 0) throw new MissingLandedCostFxRateError("USD");
  if (rate <= 0 && purchaseUsd <= 0 && (input.lotCosts || []).length === 0 && Object.keys(input.lotExpensesByCurrency || {}).length === 0) return empty;

  const costs = input.lotCosts || [];
  const afnToPkrRate = resolveAfnToPkrRate(costs);
  const cnyToPkrRate = resolveCnyToPkrRate(costs);

  const freightPkr = costs
    .filter((c) => c.costType === "freight")
    .reduce((s, c) => s + lotCostToPkr(c, rate), 0);

  const purchasePkr = purchaseUsd * rate;
  const nonFreightCostsPkr = costs
    .filter((c) => c.costType !== "freight")
    .reduce((s, c) => s + lotCostToPkr(c, rate), 0);
  const lotExpensesPkr = lotExpensesByCurrencyToPkr(
    input.lotExpensesByCurrency || {},
    rate,
    afnToPkrRate,
    cnyToPkrRate
  );

  const totalLandedCostPkr = purchasePkr + freightPkr + nonFreightCostsPkr + lotExpensesPkr;
  const totalCartons = num(input.totalCartons);
  const landedCostPerCartonPkr = totalCartons > 0 ? totalLandedCostPkr / totalCartons : 0;

  return {
    totalLandedCostPkr: round2(totalLandedCostPkr),
    landedCostPerCartonPkr: round2(landedCostPerCartonPkr),
    purchasePkr: round2(purchasePkr),
    freightPkr: round2(freightPkr),
    nonFreightCostsPkr: round2(nonFreightCostsPkr),
    lotExpensesPkr: round2(lotExpensesPkr),
    afnToPkrRate,
    cnyToPkrRate,
  };
}
