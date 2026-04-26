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

export function getQueueResolvePath(entityType: string): string | null {
  if (entityType === "sale") return "/sales";
  if (entityType === "payment") return "/payments";
  if (entityType === "expense") return "/expenses";
  if (entityType === "haji_transfer") return "/haji-transfers";
  if (entityType === "personal_withdrawal") return "/personal-withdrawals";
  if (entityType === "customer") return "/customers";
  if (entityType === "city_transfer") return "/city-transfers";
  if (entityType === "bank_deposit") return "/bank-deposits";
  return null;
}
