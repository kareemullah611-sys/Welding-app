import assert from "node:assert/strict";
import test from "node:test";
import { getOfflineConflictHint } from "@/lib/offline-conflict-hints";

test("returns resolve-form hint for cheque conflicts", () => {
  const hint = getOfflineConflictHint("/api/v1/expenses", "Cheque is no longer available for expense use");
  assert.equal(hint.recommended, "resolve_form");
});

test("returns discard hint for duplicate/already-synced errors", () => {
  const hint = getOfflineConflictHint("/api/v1/customers", "Customer already synced");
  assert.equal(hint.recommended, "discard");
});

test("returns retry fallback for generic network error", () => {
  const hint = getOfflineConflictHint("/api/v1/payments", "Network error");
  assert.equal(hint.recommended, "retry");
});
