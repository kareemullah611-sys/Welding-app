import assert from "node:assert/strict";
import test from "node:test";

import { packagedFetchWithTimeout } from "./packaged-api";

test("packaged fetch timeout settles even when native fetch ignores AbortSignal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;

  try {
    const outcome = await Promise.race([
      packagedFetchWithTimeout("/api/v1/auth/me", {}, 20).then(
        () => "resolved",
        (error: Error) => error.name
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 100)),
    ]);

    assert.equal(outcome, "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
