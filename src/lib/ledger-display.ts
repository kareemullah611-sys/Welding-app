export type LedgerDisplayRow = {
  date: Date | string;
  createdAt?: Date | string;
  currencyCode: string;
  credit: number;
  debit: number;
  runningBalance?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const toTime = (value: Date | string | undefined) => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Newest transaction first; same-day rows use createdAt descending. */
export function compareLedgerRowsDesc(a: LedgerDisplayRow, b: LedgerDisplayRow): number {
  const dateDiff = toTime(b.date) - toTime(a.date);
  if (dateDiff !== 0) return dateDiff;
  return toTime(b.createdAt) - toTime(a.createdAt);
}

export function sortLedgerNewestFirst<T extends LedgerDisplayRow>(rows: T[]): T[] {
  return [...rows].sort(compareLedgerRowsDesc);
}

/** Chronological running balance per currency, then newest-first for display. */
export function finalizeLedgerForDisplay<T extends LedgerDisplayRow>(rows: T[]): {
  ledger: T[];
  balanceByCurrency: Record<string, number>;
} {
  const runningByCurrency: Record<string, number> = {};
  const asc = [...rows].sort((a, b) => -compareLedgerRowsDesc(a, b));
  for (const row of asc) {
    const curr = row.currencyCode;
    const next = round2((runningByCurrency[curr] || 0) + row.credit - row.debit);
    runningByCurrency[curr] = next;
    row.runningBalance = next;
  }
  return {
    ledger: sortLedgerNewestFirst(asc),
    balanceByCurrency: runningByCurrency,
  };
}
