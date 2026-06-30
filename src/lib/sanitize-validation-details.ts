const SENSITIVE_FIELD_RE = /password|secret|token|apikey|api_key|credential|authorization/i;

function issuePathString(path: unknown): string {
  if (Array.isArray(path)) return path.map(String).join(".");
  return String(path ?? "");
}

function sanitizeValidationIssue(issue: unknown): unknown {
  if (!issue || typeof issue !== "object") return issue;
  const obj = issue as Record<string, unknown>;
  const pathStr = issuePathString(obj.path);
  if (!SENSITIVE_FIELD_RE.test(pathStr)) return issue;

  const { received: _r, input: _i, ...rest } = obj;
  return { ...rest, message: "Invalid value" };
}

/** Strip password/secret field values from Zod issues before API responses. */
export function sanitizeValidationDetails(details: unknown[] | undefined): unknown[] | undefined {
  if (!details?.length) return details;
  return details.map(sanitizeValidationIssue);
}
