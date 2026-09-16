export type LotProfitSaleInput = {
  saleId: number;
  recognizedRevenuePkr: number;
  items: Array<{ lotId: number; revenueWeight: number; cartons: number }>;
};

export type LotProfitAmountInput = {
  lotId: number | null;
  amountPkr: number;
  kind?: "discount" | "other";
};

export type AuthoritativeLotProfitTotals = {
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalExpenses: number;
  totalFxGains: number;
  totalFxLosses: number;
  netProfit: number;
};

export type LotProfitTotals = {
  lotId: number;
  cartonsSold: number;
  grossRevenuePkr: number;
  discountsPkr: number;
  revenuePkr: number;
  cogsPkr: number;
  directExpensesPkr: number;
  grossProfitPkr: number;
  netProfitBeforeFxPkr: number;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function ensureLot(byLot: Map<number, LotProfitTotals>, lotId: number): LotProfitTotals {
  const existing = byLot.get(lotId);
  if (existing) return existing;
  const created: LotProfitTotals = {
    lotId,
    cartonsSold: 0,
    grossRevenuePkr: 0,
    discountsPkr: 0,
    revenuePkr: 0,
    cogsPkr: 0,
    directExpensesPkr: 0,
    grossProfitPkr: 0,
    netProfitBeforeFxPkr: 0,
  };
  byLot.set(lotId, created);
  return created;
}

export function allocateMoneyByWeights(total: number, weights: number[]): number[] {
  const totalCents = Math.round(finite(total) * 100);
  const normalized = weights.map((weight) => Math.max(0, finite(weight)));
  const totalWeight = normalized.reduce((sum, weight) => sum + weight, 0);
  if (!normalized.length || totalWeight <= 0) return normalized.map(() => 0);

  let allocatedCents = 0;
  return normalized.map((weight, index) => {
    const cents = index === normalized.length - 1
      ? totalCents - allocatedCents
      : Math.round((totalCents * weight) / totalWeight);
    allocatedCents += cents;
    return cents / 100;
  });
}

export function buildLotProfitReconciliation(input: {
  sales: LotProfitSaleInput[];
  revenueAdjustments: LotProfitAmountInput[];
  cogsEntries: LotProfitAmountInput[];
  expenseEntries: LotProfitAmountInput[];
  authoritative: AuthoritativeLotProfitTotals;
}) {
  const byLot = new Map<number, LotProfitTotals>();

  for (const sale of input.sales) {
    const allocations = allocateMoneyByWeights(sale.recognizedRevenuePkr, sale.items.map((item) => item.revenueWeight));
    sale.items.forEach((item, index) => {
      const lot = ensureLot(byLot, item.lotId);
      lot.grossRevenuePkr += allocations[index] || 0;
      lot.revenuePkr += allocations[index] || 0;
      lot.cartonsSold += finite(item.cartons);
    });
  }

  for (const adjustment of input.revenueAdjustments) {
    if (!adjustment.lotId) continue;
    const lot = ensureLot(byLot, adjustment.lotId);
    const amount = finite(adjustment.amountPkr);
    lot.revenuePkr += amount;
    if (adjustment.kind === "discount" && amount < 0) lot.discountsPkr += Math.abs(amount);
  }

  for (const entry of input.cogsEntries) {
    if (!entry.lotId) continue;
    ensureLot(byLot, entry.lotId).cogsPkr += finite(entry.amountPkr);
  }

  for (const entry of input.expenseEntries) {
    if (!entry.lotId) continue;
    ensureLot(byLot, entry.lotId).directExpensesPkr += finite(entry.amountPkr);
  }

  for (const lot of byLot.values()) {
    lot.cartonsSold = round2(lot.cartonsSold);
    lot.grossRevenuePkr = round2(lot.grossRevenuePkr);
    lot.discountsPkr = round2(lot.discountsPkr);
    lot.revenuePkr = round2(lot.revenuePkr);
    lot.cogsPkr = round2(lot.cogsPkr);
    lot.directExpensesPkr = round2(lot.directExpensesPkr);
    lot.grossProfitPkr = round2(lot.revenuePkr - lot.cogsPkr);
    lot.netProfitBeforeFxPkr = round2(lot.grossProfitPkr - lot.directExpensesPkr);
  }

  const lotRows = [...byLot.values()];
  const lotRevenuePkr = round2(lotRows.reduce((sum, lot) => sum + lot.revenuePkr, 0));
  const lotCogsPkr = round2(lotRows.reduce((sum, lot) => sum + lot.cogsPkr, 0));
  const lotGrossProfitPkr = round2(lotRevenuePkr - lotCogsPkr);
  const directLotExpensesPkr = round2(lotRows.reduce((sum, lot) => sum + lot.directExpensesPkr, 0));
  const unallocatedExpensesPkr = round2(input.authoritative.totalExpenses - directLotExpensesPkr);
  const bridgedNetProfitPkr = round2(
    lotGrossProfitPkr
      - directLotExpensesPkr
      - unallocatedExpensesPkr
      + input.authoritative.totalFxGains
      - input.authoritative.totalFxLosses,
  );
  const revenueDifferencePkr = round2(input.authoritative.totalRevenue - lotRevenuePkr);
  const cogsDifferencePkr = round2(input.authoritative.totalCOGS - lotCogsPkr);
  const grossProfitDifferencePkr = round2(input.authoritative.grossProfit - lotGrossProfitPkr);
  const netProfitDifferencePkr = round2(input.authoritative.netProfit - bridgedNetProfitPkr);
  const differences = [revenueDifferencePkr, cogsDifferencePkr, grossProfitDifferencePkr, netProfitDifferencePkr];

  return {
    byLot,
    reconciliation: {
      lotRevenuePkr,
      lotCogsPkr,
      lotGrossProfitPkr,
      directLotExpensesPkr,
      unallocatedExpensesPkr,
      fxGainsPkr: round2(input.authoritative.totalFxGains),
      fxLossesPkr: round2(input.authoritative.totalFxLosses),
      bridgedNetProfitPkr,
      revenueDifferencePkr,
      cogsDifferencePkr,
      grossProfitDifferencePkr,
      netProfitDifferencePkr,
      status: differences.every((difference) => Math.abs(difference) <= 0.01) ? "RECONCILED" : "BLOCKED",
    } as const,
  };
}
