export function isAlreadySyncedResponse(status: number, payload: unknown): boolean {
  if (status < 400 || status >= 500) return false;
  if (!payload || typeof payload !== "object") return false;

  const data = payload as Record<string, unknown>;
  const messageParts = [
    String(data.message || ""),
    String(data.error || ""),
    String((data as any)?.error?.message || ""),
  ]
    .join(" ")
    .toLowerCase();

  if (!messageParts.trim()) return false;

  return (
    messageParts.includes("already synced") ||
    messageParts.includes("already exists") ||
    messageParts.includes("duplicate") ||
    messageParts.includes("already approved") ||
    messageParts.includes("already cancelled")
  );
}
