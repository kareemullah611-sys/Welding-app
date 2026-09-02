import { MissingLandedCostFxRateError, lotCostToPkr, lotExpensesByCurrencyToPkr, resolveAfnToPkrRate, resolveCnyToPkrRate, type LotCostLike } from "@/lib/landed-cost-pkr";

export type LotCostLedgerRow = {
  date: string;
  particulars: string;
  amount: number;
  currencyCode: string;
  acquisitionRateToPkr: number | null;
  amountPkr: number;
  runningPkr: number;
  payFromLabel: string;
  sourceType: "purchase" | "lot_cost" | "lot_expense";
  sourceId: number;
};

export type LotCostLedgerInput = {
  lotDate: string;
  lotCountryCode: string;
  usdPkrRate?: number;
  purchaseItems: Array<{
    id: number;
    supplierName: string;
    productName: string;
    totalPriceUsd: number;
    createdAt?: string | Date | null;
  }>;
  lotCosts: Array<
    LotCostLike & {
      id: number;
      costType?: string | null;
      description?: string | null;
      costDate?: string | Date | null;
      debitChannelLabel?: string | null;
      createdAt?: string | Date | null;
    }
  >;
  lotExpensesByCurrency: Record<string, number>;
  supplierPaymentsForLot?: Array<{ amountUsd: number; exchangeRate?: unknown; paymentDate?: string | Date }>;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function rowDate(value: string | Date | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().split("T")[0];
}

function purchasePkrAtRecognition(purchaseUsd: number, recognitionRate: number): { amountPkr: number; rate: number | null } {
  if (purchaseUsd <= 0) return { amountPkr: 0, rate: null };
  if (recognitionRate <= 0) throw new MissingLandedCostFxRateError("USD");
  return { amountPkr: round2(purchaseUsd * recognitionRate), rate: round2(recognitionRate) };
}

export function buildLotCostLedger(input: LotCostLedgerInput): {
  rows: LotCostLedgerRow[];
  costSummary: {
    purchaseUsd: number;
    otherCostsByCurrency: Record<string, number>;
    totalLandedCostPkr: number;
  };
} {
  const lotDate = input.lotDate;
  const usdPkrFallback = num(input.usdPkrRate);
  const costs = input.lotCosts || [];
  const afnRate = resolveAfnToPkrRate(costs);
  const cnyRate = resolveCnyToPkrRate(costs);

  const rawRows: Omit<LotCostLedgerRow, "runningPkr">[] = [];

  for (const p of input.purchaseItems) {
    const amount = round2(num(p.totalPriceUsd));
    const { amountPkr, rate } = purchasePkrAtRecognition(amount, usdPkrFallback);
    rawRows.push({
      date: rowDate(p.createdAt, lotDate),
      particulars: `Purchase — ${p.productName}`,
      amount,
      currencyCode: "USD",
      acquisitionRateToPkr: rate,
      amountPkr,
      payFromLabel: "Supplier liability",
      sourceType: "purchase",
      sourceId: p.id,
    });
  }

  for (const c of costs) {
    const currencyCode = String(c.currencyCode || "PKR").toUpperCase();
    const rate = requiresRate(currencyCode) ? num(c.exchangeRate) || null : null;
    const amount = round2(num(c.amount));
    const amountPkr = round2(lotCostToPkr(c, usdPkrFallback));
    rawRows.push({
      date: rowDate(c.costDate || c.createdAt, lotDate),
      particulars: `${formatCostType(c.costType)} — ${c.description || ""}`.trim(),
      amount,
      currencyCode,
      acquisitionRateToPkr: rate,
      amountPkr,
      payFromLabel: c.debitChannelLabel || "General Payable",
      sourceType: "lot_cost",
      sourceId: c.id,
    });
  }

  const expensePkr = lotExpensesByCurrencyToPkr(input.lotExpensesByCurrency || {}, 0, afnRate, cnyRate);
  const expenseNative = Object.entries(input.lotExpensesByCurrency || {}).reduce((s, [, v]) => s + num(v), 0);
  if (expenseNative > 0 || expensePkr > 0) {
    rawRows.push({
      date: lotDate,
      particulars: "City lot expenses",
      amount: round2(expenseNative || expensePkr),
      currencyCode: expensePkr > 0 && expenseNative === num(input.lotExpensesByCurrency?.PKR) ? "PKR" : "MIXED",
      acquisitionRateToPkr: null,
      amountPkr: round2(expensePkr),
      payFromLabel: "City admin",
      sourceType: "lot_expense",
      sourceId: 0,
    });
  }

  rawRows.sort((a, b) => a.date.localeCompare(b.date) || a.sourceId - b.sourceId);

  let running = 0;
  const rows: LotCostLedgerRow[] = rawRows.map((r) => {
    running = round2(running + r.amountPkr);
    return { ...r, runningPkr: running };
  });

  const purchaseUsd = input.purchaseItems.reduce((s, p) => s + num(p.totalPriceUsd), 0);
  const otherCostsByCurrency: Record<string, number> = {};
  for (const c of costs) {
    const code = String(c.currencyCode || "PKR").toUpperCase();
    otherCostsByCurrency[code] = (otherCostsByCurrency[code] || 0) + num(c.amount);
  }

  const totalLandedCostPkr = round2(rows.reduce((s, r) => s + r.amountPkr, 0));

  return {
    rows,
    costSummary: {
      purchaseUsd: round2(purchaseUsd),
      otherCostsByCurrency,
      totalLandedCostPkr,
    },
  };
}

function requiresRate(code: string) {
  return code === "USD" || code === "CNY" || code === "AFN";
}

function formatCostType(costType: string | null | undefined): string {
  return String(costType || "other").replace(/_/g, " ");
}
