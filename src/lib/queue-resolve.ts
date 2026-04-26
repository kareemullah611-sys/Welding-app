export function safeParseQueuedBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isEditableCustomerQueuedPayload(payload: Record<string, unknown> | null): payload is { name: string; phone?: string; address?: string; cityId?: number } {
  if (!payload) return false;
  return typeof payload.name === "string" && payload.name.trim().length > 0;
}
