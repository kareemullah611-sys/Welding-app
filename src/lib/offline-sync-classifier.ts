/**
 * Detect whether a 4xx response means "this exact write was already applied" as
 * opposed to "this write is invalid".
 *
 * Genuine idempotent replays are answered with a 200 success response by the API
 * (e.g. "Payment already synced"), which the queue treats as synced without this
 * helper. So a 4xx here is always a real failure. Matching on words like
 * "duplicate" or "already exists" would classify business validation errors
 * (duplicate lot number, duplicate cheque number) as successful and silently
 * discard the user's queued entry, so only an explicit machine-readable
 * sync-replay marker is honoured.
 */
const ALREADY_SYNCED_CODES = new Set(["ALREADY_SYNCED", "SYNC_REPLAY"]);

export function isAlreadySyncedResponse(status: number, payload: unknown): boolean {
  if (status < 400 || status >= 500) return false;
  if (!payload || typeof payload !== "object") return false;

  const data = payload as Record<string, unknown>;
  const error = data.error as Record<string, unknown> | string | undefined;
  const code =
    typeof error === "object" && error
      ? String((error as { code?: unknown }).code || "")
      : String((data as { code?: unknown }).code || "");

  return ALREADY_SYNCED_CODES.has(code.toUpperCase());
}
