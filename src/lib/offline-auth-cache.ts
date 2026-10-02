export const OFFLINE_AUTH_CACHE_KEY = "mrf-offline-auth-cache-v2";
const LEGACY_OFFLINE_AUTH_CACHE_KEY = "mrf-offline-auth-cache-v1";
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_PREFIX = "pbkdf2-sha256";

export interface OfflineAuthUser {
  id: number;
  username: string;
  fullName: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  cityName: string | null;
  countryId: number | null;
  countryName: string | null;
  currencies?: { id: number; code: string; name: string; symbol: string }[];
}

export interface OfflineAuthCache {
  username: string;
  passwordVerifier: string;
  user: OfflineAuthUser;
  updatedAt: string;
}

/** Parsed from localStorage; legacy verifier formats are cleared on read. */
type StoredOfflineAuthCache = {
  username: string;
  passwordVerifier?: string;
  user: OfflineAuthUser;
  updatedAt: string;
};

function canUseStorage(storage: Storage | null | undefined): storage is Storage {
  return !!storage;
}

export async function buildOfflinePasswordVerifier(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    passwordKey,
    256,
  );
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyOfflinePassword(password: string, cache: StoredOfflineAuthCache): Promise<boolean> {
  if (!cache.passwordVerifier) return false;
  const [prefix, iterationsText, saltText, expectedText] = cache.passwordVerifier.split("$");
  if (prefix !== PBKDF2_PREFIX || !iterationsText || !saltText || !expectedText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations !== PBKDF2_ITERATIONS) return false;

  const salt = base64ToBytes(saltText);
  const expected = base64ToBytes(expectedText);
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    passwordKey,
    expected.byteLength * 8,
  ));
  if (actual.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actual.byteLength; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function readOfflineAuthCache(storage: Storage | null | undefined): StoredOfflineAuthCache | null {
  if (!canUseStorage(storage)) return null;
  try {
    storage.removeItem(LEGACY_OFFLINE_AUTH_CACHE_KEY);
    const raw = storage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredOfflineAuthCache & { password?: string };
    if (!parsed?.username || !parsed?.user) return null;
    if (!parsed.passwordVerifier?.startsWith(`${PBKDF2_PREFIX}$`)) {
      storage.removeItem(OFFLINE_AUTH_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeOfflineAuthCache(storage: Storage | null | undefined, cache: OfflineAuthCache): void {
  if (!canUseStorage(storage)) return;
  storage.setItem(OFFLINE_AUTH_CACHE_KEY, JSON.stringify(cache));
}

export function clearOfflineAuthCache(storage: Storage | null | undefined): void {
  if (!canUseStorage(storage)) return;
  storage.removeItem(OFFLINE_AUTH_CACHE_KEY);
  storage.removeItem(LEGACY_OFFLINE_AUTH_CACHE_KEY);
}
