type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function resolveSaleAmount(parsed: any): number {
  const explicit = Number(parsed?.totalAmount || 0);
  if (explicit > 0) return explicit;
  if (!Array.isArray(parsed?.items)) return 0;
  return parsed.items.reduce((sum: number, item: any) => sum + Number(item?.qty || 0) * Number(item?.ratePerCarton || 0), 0);
}

function resolveSaleCartons(parsed: any): number {
  if (!Array.isArray(parsed?.items)) return 0;
  return parsed.items.reduce((sum: number, item: any) => sum + Number(item?.qty || 0), 0);
}

function getYearFromDate(value: unknown): number | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

export function applyPendingProfitReportPeriod(baseData: any, queuedItems: QueuedRequestLike[], year: number) {
  if (!baseData?.profitAndLoss) return baseData;
  const next = JSON.parse(JSON.stringify(baseData));
  const pl = next.profitAndLoss || {};

  let salesDelta = 0;
  let cartonsDelta = 0;
  let expenseDelta = 0;

  for (const q of queuedItems) {
    if (String(q.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(q.body);

    if (q.url === "/api/v1/sales") {
      const y = getYearFromDate(parsed?.saleDate || parsed?.date);
      if (y !== null && y !== year) continue;
      salesDelta += resolveSaleAmount(parsed);
      cartonsDelta += resolveSaleCartons(parsed);
      continue;
    }

    if (q.url === "/api/v1/expenses") {
      const y = getYearFromDate(parsed?.expenseDate || parsed?.date);
      if (y !== null && y !== year) continue;
      expenseDelta += Number(parsed?.amount || 0);
      continue;
    }

    if (q.url === "/api/v1/haji-transfers") {
      const y = getYearFromDate(parsed?.transferDate || parsed?.date);
      if (y !== null && y !== year) continue;
      expenseDelta += Number(parsed?.amount || 0);
      continue;
    }

    if (q.url === "/api/v1/personal-withdrawals") {
      const y = getYearFromDate(parsed?.withdrawalDate || parsed?.date);
      if (y !== null && y !== year) continue;
      expenseDelta += Number(parsed?.amount || 0);
    }
  }

  if (salesDelta === 0 && cartonsDelta === 0 && expenseDelta === 0) return next;

  pl.totalRevenue = Number(pl.totalRevenue || 0) + salesDelta;
  pl.totalExpenses = Number(pl.totalExpenses || 0) + expenseDelta;
  pl.grossProfit = Number(pl.grossProfit || 0) + salesDelta;
  pl.netProfit = Number(pl.netProfit || 0) + salesDelta - expenseDelta;
  next.cartonsSold = Number(next.cartonsSold || 0) + cartonsDelta;

  const rev = Number(pl.totalRevenue || 0);
  const gross = Number(pl.grossProfit || 0);
  const net = Number(pl.netProfit || 0);
  pl.grossMarginPercent = rev > 0 ? Number(((gross / rev) * 100).toFixed(2)) : 0;
  pl.netMarginPercent = rev > 0 ? Number(((net / rev) * 100).toFixed(2)) : 0;
  next.profitAndLoss = pl;

  return next;
}
