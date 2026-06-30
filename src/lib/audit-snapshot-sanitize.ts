const SENSITIVE_KEY_RE =
  /password|secret|token|api[_-]?key|authorization|cookie|session|credential|private[_-]?key/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/** Strip credential-like fields from audit log snapshots before API responses. */
export function sanitizeAuditSnapshot(
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return values ?? null;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(values)) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = sanitizeAuditSnapshot(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}
