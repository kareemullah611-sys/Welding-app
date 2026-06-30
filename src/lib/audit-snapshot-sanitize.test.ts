import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAuditSnapshot } from "@/lib/audit-snapshot-sanitize";

test("sanitizeAuditSnapshot redacts sensitive keys", () => {
  const result = sanitizeAuditSnapshot({
    amount: 1000,
    passwordHash: "bcrypt",
    passwordPlain: "secret123",
    tokenHash: "abc",
    nested: { apiKey: "sk-test", detail: "ok" },
  });

  assert.equal(result?.amount, 1000);
  assert.equal(result?.passwordHash, "[redacted]");
  assert.equal(result?.passwordPlain, "[redacted]");
  assert.equal(result?.tokenHash, "[redacted]");
  assert.deepEqual(result?.nested, { apiKey: "[redacted]", detail: "ok" });
});

test("sanitizeAuditSnapshot preserves null input", () => {
  assert.equal(sanitizeAuditSnapshot(null), null);
});
