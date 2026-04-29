type QueuedRequestLike = {
  id: string;
  url: string;
  method: string;
  body: string;
};

type CurrencyLike = {
  id: number;
  code: string;
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function getCurrencyCode(currencies: CurrencyLike[], currencyId: number): string {
  return currencies.find((c) => c.id === currencyId)?.code || "";
}

function calculateToAmount(
  fromAmount: number,
  exchangeRate: number,
  baseCurrencyId: number,
  quoteCurrencyId: number,
  fromCurrencyId: number,
  toCurrencyId: number
) {
  if (fromCurrencyId === baseCurrencyId && toCurrencyId === quoteCurrencyId) return fromAmount * exchangeRate;
  if (fromCurrencyId === quoteCurrencyId && toCurrencyId === baseCurrencyId) return fromAmount / exchangeRate;
  return 0;
}

export function applyPendingIntermediaryLedger(base: any, queuedItems: QueuedRequestLike[], intermediaryId: number, currencies: CurrencyLike[]) {
  if (!base) return base;

  const pendingEntries: any[] = [];
  const pendingDeposits: any[] = [];
  const pendingExchanges: any[] = [];
  const nextBalances = { ...(base.balances || {}) } as Record<string, number>;

  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;

    const depositMatch = queued.url.match(/^\/api\/v1\/intermediaries\/(\d+)\/deposits$/);
    if (depositMatch && Number(depositMatch[1]) === intermediaryId) {
      const parsed = safeParse(queued.body);
      const amount = Number(parsed?.amount || 0);
      const currencyId = Number(parsed?.currencyId || 0);
      const currencyCode = getCurrencyCode(currencies, currencyId);
      if (amount > 0 && currencyCode) {
        pendingDeposits.push({
          id: `pending-${queued.id}`,
          depositDate: parsed?.depositDate || new Date().toISOString().split("T")[0],
          amount,
          currencyId,
          currencyCode,
          notes: parsed?.notes || null,
          _pending: true,
        });
        pendingEntries.push({
          id: `pending-${queued.id}`,
          date: parsed?.depositDate || new Date().toISOString().split("T")[0],
          description: parsed?.notes ? `Pending deposit - ${parsed.notes}` : "Pending deposit",
          currencyCode,
          debit: amount,
          credit: 0,
          balance: 0,
          type: "deposit",
          _pending: true,
        });
        nextBalances[currencyCode] = Number(nextBalances[currencyCode] || 0) + amount;
      }
      continue;
    }

    const exchangeMatch = queued.url.match(/^\/api\/v1\/intermediaries\/(\d+)\/exchanges$/);
    if (exchangeMatch && Number(exchangeMatch[1]) === intermediaryId) {
      const parsed = safeParse(queued.body);
      const fromAmount = Number(parsed?.fromAmount || 0);
      const exchangeRate = Number(parsed?.exchangeRate || 0);
      const baseCurrencyId = Number(parsed?.baseCurrencyId || 0);
      const quoteCurrencyId = Number(parsed?.quoteCurrencyId || 0);
      const fromCurrencyId = Number(parsed?.fromCurrencyId || 0);
      const toCurrencyId = Number(parsed?.toCurrencyId || 0);
      const fromCode = getCurrencyCode(currencies, fromCurrencyId);
      const toCode = getCurrencyCode(currencies, toCurrencyId);
      if (fromAmount > 0 && exchangeRate > 0 && fromCode && toCode) {
        const toAmount = calculateToAmount(fromAmount, exchangeRate, baseCurrencyId, quoteCurrencyId, fromCurrencyId, toCurrencyId);
        if (toAmount > 0) {
          pendingExchanges.push({
            id: `pending-${queued.id}`,
            exchangeDate: parsed?.exchangeDate || new Date().toISOString().split("T")[0],
            baseCurrencyId,
            quoteCurrencyId,
            fromCurrencyId,
            fromCurrencyCode: fromCode,
            fromAmount,
            toCurrencyId,
            toCurrencyCode: toCode,
            toAmount,
            exchangeRate,
            notes: parsed?.notes || null,
            _pending: true,
          });
          pendingEntries.push({
            id: `pending-${queued.id}-out`,
            date: parsed?.exchangeDate || new Date().toISOString().split("T")[0],
            description: parsed?.notes ? `Pending exchange out - ${parsed.notes}` : "Pending exchange out",
            currencyCode: fromCode,
            debit: 0,
            credit: fromAmount,
            balance: 0,
            type: "exchange_out",
            _pending: true,
          });
          pendingEntries.push({
            id: `pending-${queued.id}-in`,
            date: parsed?.exchangeDate || new Date().toISOString().split("T")[0],
            description: parsed?.notes ? `Pending exchange in - ${parsed.notes}` : "Pending exchange in",
            currencyCode: toCode,
            debit: toAmount,
            credit: 0,
            balance: 0,
            type: "exchange_in",
            _pending: true,
          });
          nextBalances[fromCode] = Number(nextBalances[fromCode] || 0) - fromAmount;
          nextBalances[toCode] = Number(nextBalances[toCode] || 0) + toAmount;
        }
      }
    }
  }

  return {
    ...base,
    balances: nextBalances,
    depositHistory: [...pendingDeposits, ...(base.depositHistory || [])],
    exchangeHistory: [...pendingExchanges, ...(base.exchangeHistory || [])],
    ledger: [...pendingEntries, ...(base.ledger || [])],
  };
}
