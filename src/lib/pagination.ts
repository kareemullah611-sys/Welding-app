export type PaginationItem = number | "...";

/** Default rows per page for city/super-admin list tables. */
export const DEFAULT_LIST_PAGE_SIZE = 15;

export function buildPaginationItems(page: number, totalPages: number): PaginationItem[] {
  const safeTotal = Math.max(1, Math.floor(totalPages || 1));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), safeTotal);
  if (safeTotal <= 6) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  if (safePage <= 3) {
    return [1, 2, 3, 4, "...", safeTotal];
  }

  if (safePage >= safeTotal - 2) {
    return [1, "...", safeTotal - 3, safeTotal - 2, safeTotal - 1, safeTotal];
  }

  return [1, "...", safePage - 1, safePage, safePage + 1, "...", safeTotal];
}

export function getLedgerPaginationParams(searchParams: URLSearchParams): {
  page: number;
  limit: number;
} {
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") || String(DEFAULT_LIST_PAGE_SIZE), 10);
  const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
  const limit = Math.min(
    10000,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIST_PAGE_SIZE)
  );
  return { page, limit };
}

export function paginateList<T>(items: T[], page: number, limit: number): {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
} {
  const safeLimit = Math.min(10000, Math.max(1, Math.floor(limit || DEFAULT_LIST_PAGE_SIZE)));
  const safePage = Math.max(1, Math.floor(page || 1));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

export function getPaginationRange({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}): { start: number; end: number } {
  const safeTotal = Math.max(0, Math.floor(total || 0));
  if (safeTotal === 0) return { start: 0, end: 0 };
  const safePageSize = Math.max(1, Math.floor(pageSize || 1));
  const safePage = Math.max(1, Math.floor(page || 1));
  const start = (safePage - 1) * safePageSize + 1;
  const end = Math.min(safeTotal, start + safePageSize - 1);
  return { start, end };
}
