type QueuedRequestLike = {
  id: string;
  url: string;
  method: string;
  body: string;
};

type LedgerRow = {
  date: string;
  type: string;
  detail: string;
  reference?: string;
  debit?: number;
  credit?: number;
  runningBalance?: number;
  _pending?: boolean;
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function pushPendingRow(rows: LedgerRow[], payload: Partial<LedgerRow>) {
  rows.push({
    date: payload.date || new Date().toISOString().slice(0, 10),
    type: payload.type || "Pending",
    detail: payload.detail || "Pending offline entry",
    reference: payload.reference || "—",
    debit: Number(payload.debit || 0),
    credit: Number(payload.credit || 0),
    runningBalance: payload.runningBalance,
    _pending: true,
  });
}

export function applyPendingBankLedger(
  baseRows: LedgerRow[],
  baseBalanceByCurrency: Record<string, number>,
  queuedItems: QueuedRequestLike[],
  bankAccountId: number
): { rows: LedgerRow[]; balanceByCurrency: Record<string, number> } {
  const rows = [...(baseRows || [])];
  const balanceByCurrency = { ...(baseBalanceByCurrency || {}) };

  for (const q of queuedItems) {
    if (String(q.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(q.body);
    const currency = String(parsed?.currencyCode || parsed?.currency || "PKR");

    if (q.url === "/api/v1/payments") {
      const paymentMethod = String(parsed?.paymentMethod || "");
      const destination = String(parsed?.destination || "");
      if (!["bank_transfer", "online"].includes(paymentMethod)) continue;
      if (destination !== "our_account") continue;
      if (Number(parsed?.bankAccountId || 0) !== bankAccountId) continue;
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      pushPendingRow(rows, {
        date: parsed?.paymentDate,
        type: "Payment",
        detail: "Pending offline payment to bank",
        credit: amount,
      });
      balanceByCurrency[currency] = Number(balanceByCurrency[currency] || 0) + amount;
      continue;
    }

    if (q.url === "/api/v1/expenses") {
      if (String(parsed?.paidFrom || "") !== "bank_account") continue;
      if (Number(parsed?.bankAccountId || 0) !== bankAccountId) continue;
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      pushPendingRow(rows, {
        date: parsed?.expenseDate,
        type: "Expense",
        detail: "Pending offline expense from bank",
        debit: amount,
      });
      balanceByCurrency[currency] = Number(balanceByCurrency[currency] || 0) - amount;
      continue;
    }

    if (q.url === "/api/v1/haji-transfers") {
      if (String(parsed?.sourceType || "") !== "bank_transfer") continue;
      if (Number(parsed?.bankAccountId || 0) !== bankAccountId) continue;
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      pushPendingRow(rows, {
        date: parsed?.date,
        type: "Haji",
        detail: "Pending offline haji transfer from bank",
        debit: amount,
      });
      balanceByCurrency[currency] = Number(balanceByCurrency[currency] || 0) - amount;
      continue;
    }

    if (q.url === "/api/v1/personal-withdrawals") {
      if (String(parsed?.sourceType || "") !== "bank_account") continue;
      if (Number(parsed?.bankAccountId || 0) !== bankAccountId) continue;
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      pushPendingRow(rows, {
        date: parsed?.withdrawalDate,
        type: "Withdrawal",
        detail: "Pending offline withdrawal from bank",
        debit: amount,
      });
      balanceByCurrency[currency] = Number(balanceByCurrency[currency] || 0) - amount;
      continue;
    }

    if (q.url === "/api/v1/bank-deposits") {
      if (Number(parsed?.bankAccountId || 0) !== bankAccountId) continue;
      const cashAmount = Number(parsed?.cashAmount || 0);
      const chequeAmount = Number(parsed?.chequeAmount || 0);
      const total = cashAmount + chequeAmount;
      if (total <= 0) continue;
      pushPendingRow(rows, {
        date: parsed?.depositDate,
        type: "Deposit",
        detail: "Pending offline bank deposit",
        credit: total,
      });
      balanceByCurrency[currency] = Number(balanceByCurrency[currency] || 0) + total;
      continue;
    }
  }

  const pendingRows = rows.filter((r) => r._pending);
  const existingRows = rows.filter((r) => !r._pending);
  return { rows: [...pendingRows, ...existingRows], balanceByCurrency };
}

