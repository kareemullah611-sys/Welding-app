import assert from "node:assert/strict";
import test from "node:test";

import {
  getPackagedServerReachable,
  probeServerReachable,
  setPackagedServerReachable,
} from "@/lib/offline-reachability";

test("setPackagedServerReachable updates getter", () => {
  setPackagedServerReachable(false);
  assert.equal(getPackagedServerReachable(), false);
  setPackagedServerReachable(true);
  assert.equal(getPackagedServerReachable(), true);
});

test("probeServerReachable returns true when health responds ok", async () => {
  const g = globalThis as typeof globalThis & { window?: object; fetch?: typeof fetch };
  const prevFetch = g.fetch;
  const prevWindow = g.window;
  g.window = {};
  g.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    assert.equal(await probeServerReachable(), true);
  } finally {
    g.fetch = prevFetch;
    g.window = prevWindow;
  }
});

test("probeServerReachable returns false on network failure", async () => {
  const g = globalThis as typeof globalThis & { window?: object; fetch?: typeof fetch };
  const prevFetch = g.fetch;
  const prevWindow = g.window;
  g.window = {};
  g.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    assert.equal(await probeServerReachable(), false);
  } finally {
    g.fetch = prevFetch;
    g.window = prevWindow;
  }
});
