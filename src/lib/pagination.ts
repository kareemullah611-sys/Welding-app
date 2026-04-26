export type PaginationItem = number | "...";

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
