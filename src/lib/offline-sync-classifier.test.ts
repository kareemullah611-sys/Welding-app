import assert from "node:assert/strict";
import test from "node:test";
import { isAlreadySyncedResponse } from "@/lib/offline-sync-classifier";

test("detects already-synced duplicate-style responses", () => {
  assert.equal(isAlreadySyncedResponse(409, { error: "Customer already synced" }), true);
  assert.equal(isAlreadySyncedResponse(409, { message: "Duplicate entry" }), true);
  assert.equal(isAlreadySyncedResponse(409, { error: { message: "already exists" } }), true);
});

test("ignores non-conflict and unrelated errors", () => {
  assert.equal(isAlreadySyncedResponse(200, { message: "ok" }), false);
  assert.equal(isAlreadySyncedResponse(409, { error: "Cheque is no longer available" }), false);
  assert.equal(isAlreadySyncedResponse(500, { error: "Server error" }), false);
});
