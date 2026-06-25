import test from "node:test";
import assert from "node:assert/strict";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

test("readOfflineReadSnapshot returns null for missing key", () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  assert.equal(readOfflineReadSnapshot("missing"), null);
});

test("writeOfflineReadSnapshot stores envelope and read restores it when offline enabled", () => {
  const prevEnv = process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
  process.env.NEXT_PUBLIC_OFFLINE_ENABLED = "true";
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  };
  try {
    writeOfflineReadSnapshot("k", { hello: "world" });
    const loaded = readOfflineReadSnapshot<{ hello: string }>("k");
    assert.equal(loaded?.data.hello, "world");
    assert.equal(typeof loaded?.cachedAt, "number");
  } finally {
    if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
    else process.env.NEXT_PUBLIC_OFFLINE_ENABLED = prevEnv;
  }
});

test("readOfflineReadSnapshot ignores cache when offline features are disabled", () => {
  const prevEnv = process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
  delete process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
  const store = new Map<string, string>([["k", JSON.stringify({ cachedAt: 1, data: { hello: "world" } })]]);
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  };
  try {
    assert.equal(readOfflineReadSnapshot("k"), null);
    writeOfflineReadSnapshot("k2", { hello: "ignored" });
    assert.equal(store.has("k2"), false);
  } finally {
    if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
    else process.env.NEXT_PUBLIC_OFFLINE_ENABLED = prevEnv;
  }
});
