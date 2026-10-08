import assert from "node:assert/strict";
import test from "node:test";
import { isAlreadySyncedResponse } from "@/lib/offline-sync-classifier";

test("only an explicit sync-replay code counts as already synced", () => {
  // A real replay is answered 200 by the API, so this only fires on an explicit marker.
  assert.equal(isAlreadySyncedResponse(409, { error: { code: "ALREADY_SYNCED", message: "Customer already synced" } }), true);
  assert.equal(isAlreadySyncedResponse(409, { code: "SYNC_REPLAY" }), true);
});

test("bare duplicate wording is a validation failure, not a replay", () => {
  // These are business errors on distinct writes. Treating them as synced would
  // delete the user's queued entry with no error shown.
  assert.equal(isAlreadySyncedResponse(409, { error: "Duplicate entry" }), false);
  assert.equal(isAlreadySyncedResponse(409, { error: { message: "already exists" } }), false);
  assert.equal(isAlreadySyncedResponse(409, { error: { code: "DUPLICATE", message: "Username already exists" } }), false);
});

test("ignores non-conflict and unrelated errors", () => {
  assert.equal(isAlreadySyncedResponse(200, { message: "ok" }), false);
  assert.equal(isAlreadySyncedResponse(409, { error: "Cheque is no longer available" }), false);
  assert.equal(isAlreadySyncedResponse(500, { error: "Server error" }), false);
});
