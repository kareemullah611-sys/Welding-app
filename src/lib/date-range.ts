const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid business date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid business date: ${value}`);
  }
  return date;
}

export function buildDateRange(dateFrom?: string | null, dateTo?: string | null): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  if (dateFrom) range.gte = parseDateOnly(dateFrom);
  if (dateTo) {
    const end = parseDateOnly(dateTo);
    end.setUTCDate(end.getUTCDate() + 1);
    range.lt = end;
  }
  return range;
}

export function buildYearDateRange(year: number): { gte: Date; lt: Date } {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error(`Invalid report year: ${year}`);
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}
