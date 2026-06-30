/** Redact free-text fields before sending to a third-party LLM. */
export function redactAssistantDetail(detail: string | null | undefined, maxLen = 80): string {
  if (!detail?.trim()) return "—";
  const trimmed = detail.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/** Use stable IDs instead of person/company names in external AI context. */
export function assistantEntityLabel(prefix: string, id: number): string {
  return `${prefix}-${id}`;
}
