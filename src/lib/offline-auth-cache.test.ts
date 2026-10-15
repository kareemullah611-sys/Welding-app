import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OFFLINE_AUTH_CACHE_KEY,
  buildOfflinePasswordVerifier,
  clearOfflineAuthCache,
  readOfflineAuthCache,
  verifyOfflinePassword,
  writeOfflineAuthCache,
} from "@/lib/offline-auth-cache";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const sampleUser = {
  id: 1,
  username: "demo",
  fullName: "Demo",
  role: "city_admin" as const,
  cityId: 10,
  cityName: "Kandahar",
  countryId: 2,
  countryName: "Afghanistan",
};

const sampleSuperAdmin = {
  ...sampleUser,
  id: 2,
  username: "owner",
  fullName: "Owner",
  role: "super_admin" as const,
  cityId: null,
  cityName: null,
  countryId: null,
  countryName: null,
};

test("writes and reads offline auth cache with PBKDF2 verifier", async () => {
  const storage = new MemoryStorage();
  const passwordVerifier = await buildOfflinePasswordVerifier("secret");
  writeOfflineAuthCache(storage as unknown as Storage, {
    username: "demo",
    passwordVerifier,
    updatedAt: "2026-04-29T00:00:00.000Z",
    expiresAt: "2026-05-06T00:00:00.000Z",
    user: sampleUser,
  });
  const cached = readOfflineAuthCache(storage as unknown as Storage, new Date("2026-05-01T00:00:00.000Z"));
  assert.equal(cached?.username, "demo");
  assert.equal(cached?.user.fullName, "Demo");
  assert.equal(await verifyOfflinePassword("secret", cached!), true);
  assert.equal(await verifyOfflinePassword("wrong", cached!), false);
});

test("offline auth supports a previously verified superadmin within the cache expiry", async () => {
  const storage = new MemoryStorage();
  const passwordVerifier = await buildOfflinePasswordVerifier("owner-secret");
  writeOfflineAuthCache(storage as unknown as Storage, {
    username: "owner",
    passwordVerifier,
    updatedAt: "2026-04-29T00:00:00.000Z",
    expiresAt: "2026-05-06T00:00:00.000Z",
    user: sampleSuperAdmin,
  });
  const cached = readOfflineAuthCache(storage as unknown as Storage, new Date("2026-05-01T00:00:00.000Z"));
  assert.equal(cached?.user.role, "super_admin");
  assert.equal(await verifyOfflinePassword("owner-secret", cached!), true);
});

test("expired or legacy offline auth cache fails closed and is removed", async () => {
  const storage = new MemoryStorage();
  const passwordVerifier = await buildOfflinePasswordVerifier("secret");
  storage.setItem(OFFLINE_AUTH_CACHE_KEY, JSON.stringify({
    username: "demo",
    passwordVerifier,
    updatedAt: "2026-04-01T00:00:00.000Z",
    expiresAt: "2026-04-08T00:00:00.000Z",
    user: sampleUser,
  }));
  assert.equal(readOfflineAuthCache(storage as unknown as Storage, new Date("2026-05-01T00:00:00.000Z")), null);
  assert.equal(storage.getItem(OFFLINE_AUTH_CACHE_KEY), null);

  storage.setItem(OFFLINE_AUTH_CACHE_KEY, JSON.stringify({
    username: "demo",
    passwordVerifier,
    updatedAt: "2026-04-01T00:00:00.000Z",
    user: sampleUser,
  }));
  assert.equal(readOfflineAuthCache(storage as unknown as Storage, new Date("2026-04-02T00:00:00.000Z")), null);
  assert.equal(storage.getItem(OFFLINE_AUTH_CACHE_KEY), null);
});

test("offline verifier uses browser Web Crypto without bcrypt polyfills", async () => {
  const source = readFileSync("src/lib/offline-auth-cache.ts", "utf8");
  const verifier = await buildOfflinePasswordVerifier("secret");

  assert.doesNotMatch(source, /from ["']bcryptjs["']/);
  assert.match(verifier, /^pbkdf2-sha256\$/);
});

test("clear removes offline auth cache", () => {
  const storage = new MemoryStorage();
  storage.setItem(OFFLINE_AUTH_CACHE_KEY, "{}");
  clearOfflineAuthCache(storage as unknown as Storage);
  assert.equal(storage.getItem(OFFLINE_AUTH_CACHE_KEY), null);
});
