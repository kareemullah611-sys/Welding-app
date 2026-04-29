type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

type DashboardLike = {
  outstandingByCurrency?: Record<string, number>;
  hajiByCurrency?: Record<string, number>;
  totalCartonsSold?: number;
};

type CashPositionLike = {
  incomingToHand?: {
    opening?: number;
    cash?: number;
    cheque?: number;
    bankTransfer?: number;
    online?: number;
    total?: number;
  };
  directToHaji?: number;
  outgoing?: {
    expenses?: number;
    personalWithdrawals?: number;
    hajiTransfers?: number;
    total?: number;
  };
  netCashInHand?: number;
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function ensureCurrencyMap(source?: Record<string, number>): Record<string, number> {
  return { ...(source || {}) };
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

export function applyPendingDashboardMetrics(
  baseData: DashboardLike | null,
  baseCashPosition: CashPositionLike | null,
  queuedItems: QueuedRequestLike[]
): { data: DashboardLike | null; cashPosition: CashPositionLike | null } {
  if (!baseData && !baseCashPosition) return { data: baseData, cashPosition: baseCashPosition };

  const data = baseData ? {
    ...baseData,
    outstandingByCurrency: ensureCurrencyMap(baseData.outstandingByCurrency),
    hajiByCurrency: ensureCurrencyMap(baseData.hajiByCurrency),
    totalCartonsSold: Number(baseData.totalCartonsSold || 0),
  } : null;

  const cashPosition = baseCashPosition ? {
    ...baseCashPosition,
    incomingToHand: {
      opening: Number(baseCashPosition.incomingToHand?.opening || 0),
      cash: Number(baseCashPosition.incomingToHand?.cash || 0),
      cheque: Number(baseCashPosition.incomingToHand?.cheque || 0),
      bankTransfer: Number(baseCashPosition.incomingToHand?.bankTransfer || 0),
      online: Number(baseCashPosition.incomingToHand?.online || 0),
      total: Number(baseCashPosition.incomingToHand?.total || 0),
    },
    directToHaji: Number(baseCashPosition.directToHaji || 0),
    outgoing: {
      expenses: Number(baseCashPosition.outgoing?.expenses || 0),
      personalWithdrawals: Number(baseCashPosition.outgoing?.personalWithdrawals || 0),
      hajiTransfers: Number(baseCashPosition.outgoing?.hajiTransfers || 0),
      total: Number(baseCashPosition.outgoing?.total || 0),
    },
    netCashInHand: Number(baseCashPosition.netCashInHand || 0),
  } : null;

  for (const q of queuedItems) {
    if (String(q.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(q.body);
    const currency = String(parsed?.currencyCode || parsed?.currency || "PKR");

    if (q.url === "/api/v1/sales") {
      const saleAmount = resolveSaleAmount(parsed);
      const cartons = resolveSaleCartons(parsed);
      if (data) {
        data.outstandingByCurrency![currency] = Number(data.outstandingByCurrency![currency] || 0) + saleAmount;
        data.hajiByCurrency![currency] = Number(data.hajiByCurrency![currency] || 0) + saleAmount;
        data.totalCartonsSold = Number(data.totalCartonsSold || 0) + cartons;
      }
      continue;
    }

    if (q.url === "/api/v1/payments") {
      const amount = Number(parsed?.amount || 0);
      const destination = String(parsed?.destination || "our_account");
      const paymentMethod = String(parsed?.paymentMethod || "cash");
      if (data) {
        data.outstandingByCurrency![currency] = Number(data.outstandingByCurrency![currency] || 0) - amount;
        if (destination === "haji") {
          data.hajiByCurrency![currency] = Number(data.hajiByCurrency![currency] || 0) - amount;
        }
      }
      if (cashPosition) {
        if (destination === "our_account") {
          if (paymentMethod === "cheque") cashPosition.incomingToHand!.cheque! += amount;
          else if (paymentMethod === "bank_transfer") cashPosition.incomingToHand!.bankTransfer! += amount;
          else if (paymentMethod === "online") cashPosition.incomingToHand!.online! += amount;
          else cashPosition.incomingToHand!.cash! += amount;
          cashPosition.incomingToHand!.total! += amount;
          cashPosition.netCashInHand! += amount;
        } else if (destination === "haji") {
          cashPosition.directToHaji! += amount;
        }
      }
      continue;
    }

    if (q.url === "/api/v1/expenses") {
      const amount = Number(parsed?.amount || 0);
      if (data) data.hajiByCurrency![currency] = Number(data.hajiByCurrency![currency] || 0) - amount;
      if (cashPosition) {
        cashPosition.outgoing!.expenses! += amount;
        cashPosition.outgoing!.total! += amount;
        cashPosition.netCashInHand! -= amount;
      }
      continue;
    }

    if (q.url === "/api/v1/personal-withdrawals") {
      const amount = Number(parsed?.amount || 0);
      if (cashPosition) {
        cashPosition.outgoing!.personalWithdrawals! += amount;
        cashPosition.outgoing!.total! += amount;
        cashPosition.netCashInHand! -= amount;
      }
      continue;
    }

    if (q.url === "/api/v1/haji-transfers") {
      const amount = Number(parsed?.amount || 0);
      const transferType = String(parsed?.transferType || "from_in_hand");
      if (data) data.hajiByCurrency![currency] = Number(data.hajiByCurrency![currency] || 0) - amount;
      if (cashPosition && transferType === "from_in_hand") {
        cashPosition.outgoing!.hajiTransfers! += amount;
        cashPosition.outgoing!.total! += amount;
        cashPosition.netCashInHand! -= amount;
      }
    }
  }

  return { data, cashPosition };
}

