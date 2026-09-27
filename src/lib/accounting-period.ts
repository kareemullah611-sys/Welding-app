export type AccountingPeriodInput = {
  dateFrom?: string | null;
  dateTo?: string | null;
  year?: number;
  today?: string;
  errorCode?: string;
};

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveAccountingPeriod(input: AccountingPeriodInput) {
  const dateFrom = String(input.dateFrom || "").slice(0, 10);
  const dateTo = String(input.dateTo || "").slice(0, 10);
  if (dateFrom || dateTo) {
    if (!isValidDateOnly(dateFrom) || !isValidDateOnly(dateTo) || dateFrom > dateTo) {
      throw new Error(input.errorCode || "INVALID_ACCOUNTING_PERIOD");
    }
    return { year: undefined, periodStart: dateFrom, periodEnd: dateTo };
  }

  const currentYear = Number((input.today || new Date().toISOString().slice(0, 10)).slice(0, 4));
  const resolvedYear = Number.isInteger(input.year) ? input.year! : currentYear;
  return {
    year: resolvedYear,
    periodStart: `${resolvedYear}-01-01`,
    periodEnd: `${resolvedYear}-12-31`,
  };
}
