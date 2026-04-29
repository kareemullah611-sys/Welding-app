type QueuedRequestLike = {
  id: string;
  url: string;
  method: string;
  body: string;
};

type LedgerEntry = {
  date: string;
  type: string;
  currency: string;
  detail: string;
  debit?: number;
  credit?: number;
  balance?: number | null;
  status?: string;
};

type CustomerLedgerLike = {
  ledger?: LedgerEntry[];
  balance?: number;
  balanceByCurrency?: Record<string, number>;
};

function safeJsonParse(body: string): any {
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
  return parsed.items.reduce((sum: number, item: any) => {
    return sum + Number(item?.qty || 0) * Number(item?.ratePerCarton || 0);
  }, 0);
}

export function applyPendingCustomerLedger(
  base: CustomerLedgerLike,
  queuedItems: QueuedRequestLike[],
  customerId: number
): CustomerLedgerLike {
  const baseLedger = Array.isArray(base.ledger) ? [...base.ledger] : [];
  const baseBalanceByCurrency = { ...(base.balanceByCurrency || {}) };
  const pendingEntries: LedgerEntry[] = [];

  for (const item of queuedItems) {
    if (String(item.method || "").toUpperCase() !== "POST") continue;
    if (item.url !== "/api/v1/sales" && item.url !== "/api/v1/payments") continue;
    const parsed = safeJsonParse(item.body);
    if (Number(parsed?.customerId || 0) !== customerId) continue;

    const currency = String(parsed?.currencyCode || parsed?.currency || "PKR");
    if (item.url === "/api/v1/sales") {
      const amount = resolveSaleAmount(parsed);
      if (amount <= 0) continue;
      pendingEntries.push({
        date: String(parsed?.saleDate || new Date().toISOString().slice(0, 10)),
        type: "sale",
        currency,
        detail: "Pending offline sale",
        debit: amount,
        credit: 0,
        balance: null,
        status: "pending",
      });
      baseBalanceByCurrency[currency] = Number(baseBalanceByCurrency[currency] || 0) + amount;
      continue;
    }

    const amount = Number(parsed?.amount || 0);
    if (amount <= 0) continue;
    pendingEntries.push({
      date: String(parsed?.paymentDate || parsed?.date || new Date().toISOString().slice(0, 10)),
      type: "payment",
      currency,
      detail: "Pending offline payment",
      debit: 0,
      credit: amount,
      balance: null,
      status: "pending",
    });
    baseBalanceByCurrency[currency] = Number(baseBalanceByCurrency[currency] || 0) - amount;
  }

  if (!pendingEntries.length) return base;

  return {
    ...base,
    ledger: [...pendingEntries, ...baseLedger],
    balanceByCurrency: baseBalanceByCurrency,
  };
}

