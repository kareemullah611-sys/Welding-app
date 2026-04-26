import test from "node:test";
import assert from "node:assert/strict";
import { isEditableCustomerQueuedPayload, safeParseQueuedBody } from "@/lib/queue-resolve";

test("safeParseQueuedBody parses valid object payload", () => {
  const parsed = safeParseQueuedBody('{"name":"Ali","cityId":2}');
  assert.deepEqual(parsed, { name: "Ali", cityId: 2 });
});

test("safeParseQueuedBody returns null on malformed body", () => {
  assert.equal(safeParseQueuedBody("{invalid"), null);
});

test("isEditableCustomerQueuedPayload requires a non-empty name", () => {
  assert.equal(isEditableCustomerQueuedPayload({ name: "  " }), false);
  assert.equal(isEditableCustomerQueuedPayload({ cityId: 1 }), false);
  assert.equal(isEditableCustomerQueuedPayload({ name: "Kareem" }), true);
});
