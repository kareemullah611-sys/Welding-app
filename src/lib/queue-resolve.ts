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
  if (entityType === "supplier") return "/suppliers";
  if (entityType === "intermediary") return "/intermediaries";
  if (entityType === "supplier_payment") return "/suppliers";
  if (entityType === "shipping_line_payment") return "/shipping-lines";
  if (entityType === "super_admin_personal_expense") return "/super-admin-personal-expenses";
  if (entityType === "agent_payment") return "/agents";
  if (entityType === "lot_cost") return "/lots";
  if (entityType === "opening_entry") return "/openings";
  if (entityType === "lot") return "/lots";
  if (entityType === "lot_purchase") return "/lots";
  if (entityType === "product") return "/inventory";
  if (entityType === "shipping_line") return "/shipping-lines";
  if (entityType === "agent") return "/agents";
  if (entityType === "bank_account") return "/settings/bank-accounts";
  if (entityType === "intermediary_deposit") return "/intermediaries";
  if (entityType === "intermediary_exchange") return "/intermediaries";
  if (entityType === "godown_transfer") return "/inventory";
  if (entityType === "investor_transaction") return "/investors";
  return null;
}

export function getPendingQueueId(value: unknown): string | null {
  const id = String(value || "");
  if (!id.startsWith("pending-")) return null;
  const queueId = id.slice("pending-".length).trim();
  return queueId || null;
}
