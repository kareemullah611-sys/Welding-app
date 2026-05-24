/** Documented sync conflict rules — shown in Activity Feed, not blocking the UI. */

export interface OfflineConflictRule {
  id: string;
  title: string;
  rule: string;
  action: string;
}

export const OFFLINE_CONFLICT_RULES: OfflineConflictRule[] = [
  {
    id: "local_queue_fifo",
    title: "Queued writes",
    rule: "Your offline entries sync in order (oldest first) when the server is reachable.",
    action: "Do nothing — sync runs in the background. Check Activity Feed for status.",
  },
  {
    id: "server_wins_edit",
    title: "Same record edited on server while you were offline",
    rule: "If the server already changed that record, your queued update may fail with a conflict (409).",
    action: "Open Activity Feed → Retry once. If it still fails, use Resolve to fix values or Discard the local copy.",
  },
  {
    id: "duplicate_create",
    title: "Already on server",
    rule: "If your offline create was already applied (duplicate voucher, idempotency key, or “already synced”), the server keeps its copy.",
    action: "Discard the queued item — your data is already live.",
  },
  {
    id: "cheque_stock",
    title: "Cheques & stock",
    rule: "Cheque-in-hand and stock checks use live server state at sync time. Offline assumptions may no longer hold.",
    action: "Resolve the form with a valid cheque/source or updated qty, then retry.",
  },
  {
    id: "approval_state",
    title: "Approvals",
    rule: "If a withdrawal was already approved on the server, a queued approval is rejected.",
    action: "Discard the queued approval.",
  },
  {
    id: "full_sync_read",
    title: "Reading data while offline",
    rule: "Lists and dashboards show your last full sync + pending local queue. Server data refreshes silently when online.",
    action: "No action needed — background sync updates local data without blocking you.",
  },
];

export function formatOfflineConflictRulesText(): string {
  return OFFLINE_CONFLICT_RULES.map(
    (r, i) => `${i + 1}. ${r.title}: ${r.rule} → ${r.action}`
  ).join("\n");
}
