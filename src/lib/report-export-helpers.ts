import type { Prisma } from "@prisma/client";

export type ExportSearchContext = {
  rawQuery: string;
  normalizedQuery: string;
  compactQuery: string;
  queryDigits: string;
  isNumericLikeQuery: boolean;
  numericQuery: number;
  hasNumericQuery: boolean;
  numericQueryUpper: number;
};

export function parseExportSearchQuery(raw: string | null | undefined): ExportSearchContext {
  const rawQuery = String(raw || "").trim();
  const normalizedQuery = rawQuery.length >= 2 ? rawQuery.toLowerCase() : "";
  const compactQuery = normalizedQuery.replace(/[\s,]/g, "");
  const queryDigits = normalizedQuery.replace(/[^\d]/g, "");
  const isNumericLikeQuery = normalizedQuery.length >= 2 && /^-?\d*\.?\d+$/.test(compactQuery);
  const numericSearchText = isNumericLikeQuery ? compactQuery : "";
  const numericQuery = numericSearchText ? Number(numericSearchText) : NaN;
  const hasNumericQuery = Number.isFinite(numericQuery);
  const decimalPlaces = numericSearchText.includes(".") ? (numericSearchText.split(".")[1] || "").length : 0;
  const numericQueryUpper = hasNumericQuery
    ? numericQuery + (decimalPlaces > 0 ? Math.pow(10, -decimalPlaces) : 1)
    : NaN;

  return {
    rawQuery,
    normalizedQuery,
    compactQuery,
    queryDigits,
    isNumericLikeQuery,
    numericQuery,
    hasNumericQuery,
    numericQueryUpper,
  };
}

export function matchesExportTextSearch(
  search: ExportSearchContext,
  values: unknown[],
  numericValues: number[] = [],
) {
  if (!search.normalizedQuery) return true;
  const includesQuery = (value: unknown) =>
    String(value ?? "").toLowerCase().includes(search.normalizedQuery);
  const digitsOnly = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");
  const numericContains = (value: unknown) =>
    search.queryDigits.length >= 2 && digitsOnly(value).includes(search.queryDigits);
  const inNumericWindow = (value: number) =>
    Number.isFinite(value) && value >= search.numericQuery && value < search.numericQueryUpper;

  if (values.some(includesQuery)) return true;
  if (numericValues.some((value) => numericContains(value))) return true;
  if (search.hasNumericQuery && numericValues.some(inNumericWindow)) return true;
  return false;
}

export function buildPaymentExportSearchWhere(search: ExportSearchContext) {
  if (!search.normalizedQuery || search.isNumericLikeQuery) {
    if (!search.hasNumericQuery) return undefined;
    return {
      OR: [
        { amount: { gte: search.numericQuery, lt: search.numericQueryUpper } },
        { usdEquivalent: { gte: search.numericQuery, lt: search.numericQueryUpper } },
      ],
    };
  }
  return {
    OR: [
      { detail: { contains: search.rawQuery, mode: "insensitive" as const } },
      { notes: { contains: search.rawQuery, mode: "insensitive" as const } },
      { manualVoucherNo: { contains: search.rawQuery, mode: "insensitive" as const } },
      { chequeNumber: { contains: search.rawQuery, mode: "insensitive" as const } },
      { customer: { name: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { lot: { lotNumber: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { city: { name: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { currency: { code: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { currency: { symbol: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { bankAccount: { bankName: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { bankAccount: { accountNumber: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { superAdminBankAccount: { bankName: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { superAdminBankAccount: { accountNumber: { contains: search.rawQuery, mode: "insensitive" as const } } },
      ...(search.hasNumericQuery
        ? [
            { amount: { gte: search.numericQuery, lt: search.numericQueryUpper } },
            { usdEquivalent: { gte: search.numericQuery, lt: search.numericQueryUpper } },
          ]
        : []),
    ],
  };
}

export function buildExpenseExportSearchWhere(search: ExportSearchContext): Prisma.ExpenseWhereInput | undefined {
  if (!search.normalizedQuery) return undefined;
  const paidFromValues = ["cash_office", "bank_account", "cheque"] as const;
  type PaidFrom = (typeof paidFromValues)[number];
  const paidFromQuery = paidFromValues.includes(search.normalizedQuery as PaidFrom)
    ? (search.normalizedQuery as PaidFrom)
    : null;
  return {
    OR: [
      { detail: { contains: search.rawQuery, mode: "insensitive" as const } },
      { notes: { contains: search.rawQuery, mode: "insensitive" as const } },
      { lot: { lotNumber: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { currency: { code: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { creator: { fullName: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { bankAccount: { bankName: { contains: search.rawQuery, mode: "insensitive" as const } } },
      { bankAccount: { accountNumber: { contains: search.rawQuery, mode: "insensitive" as const } } },
      ...(paidFromQuery ? [{ paidFrom: paidFromQuery }] : []),
      ...(search.hasNumericQuery
        ? [
            { amount: { gte: search.numericQuery, lt: search.numericQueryUpper } },
            { id: Math.trunc(search.numericQuery) },
          ]
        : []),
    ],
  };
}

export type ExportPayload = {
  title: string;
  reportType?: string;
  meta: {
    generatedAt: string;
    dateFrom: string;
    dateTo: string;
    city: string;
    search: string;
  };
  headers: string[];
  rows: string[][];
};

import { formatDisplayDate } from "@/lib/display-date";
import { buildDateRange } from "@/lib/date-range";

/** dd-mm-yy for ledger/report exports */
export function formatExportDateShort(date: Date | string): string {
  const formatted = formatDisplayDate(date);
  if (formatted === "-") return String(date ?? "");
  return formatted;
}

export function formatExportMetaDate(value: string): string {
  if (!value || value === "All") return value;
  return formatExportDateShort(value);
}

export function buildExportDateFilter(dateFrom?: string | null, dateTo?: string | null) {
  const df = buildDateRange(dateFrom, dateTo);
  return Object.keys(df).length ? df : undefined;
}

export function appendExportMetaRows(
  rows: string[][],
  title: string,
  meta: ExportPayload["meta"],
) {
  rows.push([title]);
  rows.push(["Generated On", meta.generatedAt]);
  rows.push(["Date Range", meta.dateFrom, meta.dateTo]);
  rows.push(["City", meta.city]);
  if (meta.search) rows.push(["Search", meta.search]);
  rows.push([]);
}

export function buildExportMeta(
  title: string,
  cityName: string | null | undefined,
  dateFrom?: string | null,
  dateTo?: string | null,
  search?: string | null,
): { title: string; meta: ExportPayload["meta"] } {
  return {
    title,
    meta: {
      generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      dateFrom: dateFrom || "All",
      dateTo: dateTo || "All",
      city: cityName || "All Cities",
      search: String(search || "").trim(),
    },
  };
}

export function rowsToCsv(rows: string[][]) {
  const csvCell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const raw = String(value);
    const escaped = raw.replace(/"/g, "\"\"");
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function fmtReportMoney(
  amount: number | string,
  symbol?: string | null,
  code?: string | null,
): string {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  const label = String(symbol || code || "").trim();
  const formatted = Number(Math.round(numeric * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return label ? `${label} ${formatted}` : formatted;
}
