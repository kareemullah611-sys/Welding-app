interface QueueLike {
  id: string;
  pathname?: string | null;
  method?: string | null;
}

interface PendingRowLike {
  id?: unknown;
  _pending?: unknown;
}

export function pruneStalePendingRows<T extends PendingRowLike>(
  rows: T[],
  queuedItems: QueueLike[],
  pathname: string
): T[] {
  const activePendingIds = new Set(
    queuedItems
      .filter((q) => q.pathname === pathname && String(q.method || "").toUpperCase() === "POST")
      .map((q) => `pending-${q.id}`)
  );

  return rows.filter((row) => {
    if (!row?._pending) return true;
    const pendingId = String(row.id || "");
    if (!pendingId.startsWith("pending-")) return true;
    return activePendingIds.has(pendingId);
  });
}
