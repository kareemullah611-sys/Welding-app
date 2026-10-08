import test from "node:test";
import assert from "node:assert/strict";

import { isAlreadySyncedResponse } from "@/lib/offline-sync-classifier";

/**
 * Genuine idempotent replays are already 200 responses with success: true, which the
 * queue treats as synced directly (useOffline.tsx `res.ok && data?.success`). The
 * classifier therefore only ever sees errors, and must not reinterpret a business
 * validation error as "already applied" — doing so deletes the user's queued entry.
 */

test("a genuine idempotent replay is not an error, so the classifier is not consulted", () => {
  // payments/route.ts returns successResponse(..., "Payment already synced") with status 200.
  assert.equal(isAlreadySyncedResponse(200, { success: true, message: "Payment already synced" }), false);
});

test("duplicate master-data errors stay failed so the entry is not silently dropped", () => {
  const cases: Array<[number, unknown]> = [
    [409, { error: { code: "DUPLICATE", message: "Lot number L-9 already exists for Pakistan" } }],
    [409, { error: { code: "DUPLICATE", message: "Godown with this name already exists in this city" } }],
    [409, { error: { code: "DUPLICATE", message: "Username already exists" } }],
    [409, { error: { code: "CONFLICT", message: "Portal username already exists" } }],
    [409, { error: { code: "SNAPSHOT_CONFLICT", message: "A different immutable SBP rate already exists for this date" } }],
  ];

  for (const [status, payload] of cases) {
    assert.equal(
      isAlreadySyncedResponse(status, payload),
      false,
      `${status} ${JSON.stringify(payload)} must not be treated as already synced`
    );
  }
});

test("duplicate cheque-number validation is not mistaken for a replay", () => {
  assert.equal(
    isAlreadySyncedResponse(400, { error: { message: 'Cheque number "1234" already exists in an active payment for this city' } }),
    false
  );
});

test("only an explicit sync-replay marker counts as already synced", () => {
  assert.equal(isAlreadySyncedResponse(409, { error: { code: "ALREADY_SYNCED", message: "already synced" } }), true);
});

test("server errors are never treated as synced", () => {
  assert.equal(isAlreadySyncedResponse(500, { error: { message: "Database unavailable" } }), false);
  assert.equal(isAlreadySyncedResponse(503, { message: "duplicate" }), false);
});
