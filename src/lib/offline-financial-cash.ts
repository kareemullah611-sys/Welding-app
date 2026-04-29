type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

type CashEntry = { account: string; cityId?: number | null; currency: string; balance: number };
type CashReportLike = {
  cashPositions?: CashEntry[];
  bankPositions?: CashEntry[];
  intermediaryPositions?: CashEntry[];
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function addPosition(items: CashEntry[], account: string, currency: string, delta: number) {
  if (!delta) return;
  const index = items.findIndex((entry) => entry.account === account && entry.currency === currency);
  if (index >= 0) {
    items[index] = { ...items[index], balance: Number(items[index].balance || 0) + delta };
    return;
  }
  items.push({ account, currency, balance: delta, cityId: null });
}

export function applyPendingFinancialCashReport(
  baseData: CashReportLike | null,
  queuedItems: QueuedRequestLike[]
): CashReportLike | null {
  if (!baseData) return baseData;
  const cashPositions = [...(baseData.cashPositions || [])];
  const bankPositions = [...(baseData.bankPositions || [])];
  const intermediaryPositions = [...(baseData.intermediaryPositions || [])];

  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(queued.body);
    const currency = String(parsed?.currencyCode || parsed?.currency || "PKR");

    if (queued.url === "/api/v1/payments") {
      const amount = Number(parsed?.amount || 0);
      const destination = String(parsed?.destination || "");
      const paymentMethod = String(parsed?.paymentMethod || "");
      if (destination !== "our_account" || amount <= 0) continue;

      if (paymentMethod === "cash" || paymentMethod === "cheque") {
        addPosition(cashPositions, "Offline Pending Cash/Cheque", currency, amount);
      } else if (paymentMethod === "bank_transfer" || paymentMethod === "online") {
        const bankLabel = parsed?.bankAccountId ? `Offline Pending Bank #${parsed.bankAccountId}` : "Offline Pending Bank";
        addPosition(bankPositions, bankLabel, currency, amount);
      }
      continue;
    }

    if (queued.url === "/api/v1/expenses") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      if (String(parsed?.paidFrom || "") === "bank_account") {
        const bankLabel = parsed?.bankAccountId ? `Offline Pending Bank #${parsed.bankAccountId}` : "Offline Pending Bank";
        addPosition(bankPositions, bankLabel, currency, -amount);
      } else {
        addPosition(cashPositions, "Offline Pending Cash/Cheque", currency, -amount);
      }
      continue;
    }

    if (queued.url === "/api/v1/personal-withdrawals") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      if (String(parsed?.sourceType || "") === "bank_account") {
        const bankLabel = parsed?.bankAccountId ? `Offline Pending Bank #${parsed.bankAccountId}` : "Offline Pending Bank";
        addPosition(bankPositions, bankLabel, currency, -amount);
      } else {
        addPosition(cashPositions, "Offline Pending Cash/Cheque", currency, -amount);
      }
      continue;
    }

    if (queued.url === "/api/v1/haji-transfers") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      const sourceType = String(parsed?.sourceType || "");
      if (sourceType === "bank_transfer") {
        const bankLabel = parsed?.bankAccountId ? `Offline Pending Bank #${parsed.bankAccountId}` : "Offline Pending Bank";
        addPosition(bankPositions, bankLabel, currency, -amount);
      } else if (sourceType === "cash_office" || sourceType === "from_in_hand") {
        addPosition(cashPositions, "Offline Pending Cash/Cheque", currency, -amount);
      }
      continue;
    }

    if (queued.url === "/api/v1/bank-deposits") {
      const cashAmount = Number(parsed?.cashAmount || 0);
      const chequeAmount = Number(parsed?.chequeAmount || 0);
      const total = cashAmount + chequeAmount;
      if (total <= 0) continue;
      addPosition(cashPositions, "Offline Pending Cash/Cheque", currency, -total);
      const bankLabel = parsed?.bankAccountId ? `Offline Pending Bank #${parsed.bankAccountId}` : "Offline Pending Bank";
      addPosition(bankPositions, bankLabel, currency, total);
      continue;
    }
  }

  return {
    ...baseData,
    cashPositions,
    bankPositions,
    intermediaryPositions,
  };
}

