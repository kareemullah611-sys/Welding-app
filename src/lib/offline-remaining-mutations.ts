import { safeParseQueuedBody } from "@/lib/queue-resolve";

export function applyQueuedMutationsToLots(baseLots: any[], queueItems: any[]) {
  if (!Array.isArray(baseLots) || !Array.isArray(queueItems) || queueItems.length === 0) return baseLots;
  let next = [...baseLots];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/lots/")) continue;
    const match = url.match(/^\/api\/v1\/lots\/([^/?#]+)/);
    const lotId = match?.[1];
    if (!lotId) continue;
    if (method === "DELETE") {
      next = next.filter((lot: any) => String(lot?.id || "") !== lotId);
      continue;
    }
    if (url.endsWith("/complete")) {
      next = next.map((lot: any) =>
        String(lot?.id || "") === lotId ? { ...lot, status: "completed", _pending: true } : lot
      );
      continue;
    }
    if (url.endsWith("/reopen")) {
      next = next.map((lot: any) =>
        String(lot?.id || "") === lotId ? { ...lot, status: "active", _pending: true } : lot
      );
      continue;
    }
    const patch = safeParseQueuedBody(String(q?.body || "")) as any;
    next = next.map((lot: any) => {
      if (String(lot?.id || "") !== lotId) return lot;
      return {
        ...lot,
        lotNumber: patch?.lotNumber ?? lot?.lotNumber,
        lotDate: patch?.lotDate ?? lot?.lotDate,
        notes: patch?.notes ?? lot?.notes,
        _pending: true,
      };
    });
  }
  return next;
}

export function applyQueuedMutationsToCheques(baseCheques: any[], queueItems: any[]) {
  if (!Array.isArray(baseCheques) || !Array.isArray(queueItems) || queueItems.length === 0) return baseCheques;
  let next = [...baseCheques];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (method !== "PATCH") continue;
    const url = String(q?.url || "");
    const match = url.match(/^\/api\/v1\/payments\/([^/?#]+)$/);
    const paymentId = match?.[1];
    if (!paymentId) continue;
    const patch = safeParseQueuedBody(String(q?.body || "")) as any;
    if (String(patch?.action || "") !== "bounce_cheque") continue;
    next = next.map((cheque: any) =>
      String(cheque?.id || "") === paymentId
        ? {
            ...cheque,
            raw: { ...(cheque?.raw || {}), chequeStatus: "bounced" },
            _pending: true,
          }
        : cheque
    );
  }
  return next;
}

export function applyQueuedMutationsToPendingTransfers(baseTransfers: any[], queueItems: any[]) {
  if (!Array.isArray(baseTransfers) || !Array.isArray(queueItems) || queueItems.length === 0) return baseTransfers;
  let next = [...baseTransfers];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (method !== "PUT") continue;
    const url = String(q?.url || "");
    const match = url.match(/^\/api\/v1\/city-transfers\/([^/?#]+)$/);
    const transferId = match?.[1];
    if (!transferId) continue;
    const patch = safeParseQueuedBody(String(q?.body || "")) as any;
    const action = String(patch?.action || "").toLowerCase();
    if (action === "approve" || action === "reject") {
      next = next.filter((tr: any) => String(tr?.id || "") !== transferId);
    }
  }
  return next;
}
