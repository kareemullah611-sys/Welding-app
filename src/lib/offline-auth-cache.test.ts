import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_AUTH_CACHE_KEY,
  clearOfflineAuthCache,
  readOfflineAuthCache,
  writeOfflineAuthCache,
} from "@/lib/offline-auth-cache";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

test("writes and reads offline auth cache", () => {
  const storage = new MemoryStorage();
  writeOfflineAuthCache(storage as unknown as Storage, {
    username: "demo",
    password: "secret",
    updatedAt: "2026-04-29T00:00:00.000Z",
    user: {
      id: 1,
      username: "demo",
      fullName: "Demo",
      role: "city_admin",
      cityId: 10,
      cityName: "Kandahar",
      countryId: 2,
      countryName: "Afghanistan",
    },
  });
  const cached = readOfflineAuthCache(storage as unknown as Storage);
  assert.equal(cached?.username, "demo");
  assert.equal(cached?.user.fullName, "Demo");
});

test("clear removes offline auth cache", () => {
  const storage = new MemoryStorage();
  storage.setItem(OFFLINE_AUTH_CACHE_KEY, "{}");
  clearOfflineAuthCache(storage as unknown as Storage);
  assert.equal(storage.getItem(OFFLINE_AUTH_CACHE_KEY), null);
});

