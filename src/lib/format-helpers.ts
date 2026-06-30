import { formatDisplayDate } from "@/lib/display-date";

export function formatCurrency(amount: number, symbol = "Rs"): string {
  return `${symbol} ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num as number)) return "0";
  return (num as number).toLocaleString("en-US");
}

export function formatDate(dateStr: string | Date | null | undefined): string {
  return formatDisplayDate(dateStr);
}
