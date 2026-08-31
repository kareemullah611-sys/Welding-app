export type MoneyByCurrency = Record<string, number>;

export function roundLedgerAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function addLedgerAmount(target: MoneyByCurrency, currency: string, amount: number): void {
  const code = currency.toUpperCase();
  target[code] = roundLedgerAmount((target[code] || 0) + amount);
}

export function compareLedgerBalances(
  source: MoneyByCurrency,
  generalLedger: MoneyByCurrency,
): Array<{ currency: string; source: number; generalLedger: number; difference: number; reconciled: boolean }> {
  const currencies = new Set([...Object.keys(source), ...Object.keys(generalLedger)]);
  return [...currencies].sort().map((currency) => {
    const sourceAmount = roundLedgerAmount(source[currency] || 0);
    const generalLedgerAmount = roundLedgerAmount(generalLedger[currency] || 0);
    const difference = roundLedgerAmount(sourceAmount - generalLedgerAmount);
    return {
      currency,
      source: sourceAmount,
      generalLedger: generalLedgerAmount,
      difference,
      reconciled: Math.abs(difference) <= 0.01,
    };
  });
}
