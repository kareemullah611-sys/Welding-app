import bcrypt from "bcryptjs";

export const OFFLINE_AUTH_CACHE_KEY = "mrf-offline-auth-cache-v1";

/** Client-only verifier rounds (not stored on server). */
const OFFLINE_BCRYPT_ROUNDS = 8;

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

/** Parsed from localStorage — bcrypt verifier only (legacy plaintext cleared on read). */
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
  return bcrypt.hash(password, OFFLINE_BCRYPT_ROUNDS);
}

export async function verifyOfflinePassword(password: string, cache: StoredOfflineAuthCache): Promise<boolean> {
  if (!cache.passwordVerifier) return false;
  return bcrypt.compare(password, cache.passwordVerifier);
}

export function readOfflineAuthCache(storage: Storage | null | undefined): StoredOfflineAuthCache | null {
  if (!canUseStorage(storage)) return null;
  try {
    const raw = storage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredOfflineAuthCache & { password?: string };
    if (!parsed?.username || !parsed?.user) return null;
    if (!parsed.passwordVerifier) {
      // Drop legacy plaintext-only entries.
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
}
