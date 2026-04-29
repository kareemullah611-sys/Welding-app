type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

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
