export const CUSTOMER_LIST_SORTS = [
  "newest",
  "oldest",
  "name_asc",
  "name_desc",
  "balance_desc",
  "balance_asc",
] as const;

export type CustomerListSort = (typeof CUSTOMER_LIST_SORTS)[number];

type CustomerSortRow = {
  id: number | string;
  name?: string | null;
  createdAt?: Date | string | null;
  balanceByCurrency?: Record<string, number> | null;
};

export function normalizeCustomerListSort(value: string | null | undefined): CustomerListSort {
  return CUSTOMER_LIST_SORTS.includes(value as CustomerListSort)
    ? value as CustomerListSort
    : "newest";
}

function compareName(left: CustomerSortRow, right: CustomerSortRow): number {
  return String(left.name || "").localeCompare(String(right.name || ""), "en", { sensitivity: "base" });
}

function compareId(left: CustomerSortRow, right: CustomerSortRow): number {
  return Number(left.id) - Number(right.id);
}

function compareCreatedAt(left: CustomerSortRow, right: CustomerSortRow): number {
  return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
}

function currencyBalance(row: CustomerSortRow, currencyCode?: string): number {
  if (!currencyCode) return 0;
  const value = Number(row.balanceByCurrency?.[currencyCode] || 0);
  return Number.isFinite(value) ? value : 0;
}

export function sortCustomersForDisplay<T extends CustomerSortRow>(
  rows: T[],
  sort: CustomerListSort,
  balanceCurrency?: string,
): T[] {
  return [...rows].sort((left, right) => {
    let difference = 0;
    if (sort === "name_asc") difference = compareName(left, right);
    if (sort === "name_desc") difference = compareName(right, left);
    if (sort === "balance_desc") difference = currencyBalance(right, balanceCurrency) - currencyBalance(left, balanceCurrency);
    if (sort === "balance_asc") difference = currencyBalance(left, balanceCurrency) - currencyBalance(right, balanceCurrency);
    if (sort === "oldest") difference = compareCreatedAt(left, right);
    if (sort === "newest") difference = compareCreatedAt(right, left);

    return difference || compareName(left, right) || compareId(left, right);
  });
}
