import test from "node:test";
import assert from "node:assert/strict";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

test("readOfflineReadSnapshot returns null for missing key", () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  assert.equal(readOfflineReadSnapshot("missing"), null);
});

test("writeOfflineReadSnapshot stores envelope and read restores it", () => {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  };
  writeOfflineReadSnapshot("k", { hello: "world" });
  const loaded = readOfflineReadSnapshot<{ hello: string }>("k");
  assert.equal(loaded?.data.hello, "world");
  assert.equal(typeof loaded?.cachedAt, "number");
});
