import {
  OFFLINE_STOCK_STORE,
  openOfflineDatabase,
} from "@/lib/offline-cache";

type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

function openDB(): Promise<IDBDatabase> {
  return openOfflineDatabase();
}

/** Read per-godown stock rows cached after an online godown-stock fetch. */
export async function getCachedGodownStockFromDb(godownId: number): Promise<unknown[] | null> {
  if (typeof window === "undefined" || !godownId) return null;
  try {
    const db = await openDB();
    const row = await new Promise<{ stock?: unknown[] } | undefined>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STOCK_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STOCK_STORE).get(godownId);
      req.onsuccess = () => resolve(req.result as { stock?: unknown[] });
      req.onerror = () => reject(req.error);
    });
    return row?.stock ?? null;
  } catch {
    return null;
  }
}

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

export function countPendingInterGodownTransfers(queuedItems: QueuedRequestLike[]): number {
  let count = 0;
  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;
    if (queued.url !== "/api/v1/godowns/transfers") continue;
    const parsed = safeParse(queued.body);
    const qty = Number(parsed?.qty || 0);
    if (qty > 0) count += 1;
  }
  return count;
}
