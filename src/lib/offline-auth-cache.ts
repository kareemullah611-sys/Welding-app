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

/** @deprecated Legacy cache shape — migrated on read, never written. */
interface LegacyOfflineAuthCache extends Omit<Partial<OfflineAuthCache>, "passwordVerifier"> {
  password?: string;
}

function canUseStorage(storage: Storage | null | undefined): storage is Storage {
  return !!storage;
}

export async function buildOfflinePasswordVerifier(password: string): Promise<string> {
  return bcrypt.hash(password, OFFLINE_BCRYPT_ROUNDS);
}

export async function verifyOfflinePassword(password: string, cache: OfflineAuthCache | LegacyOfflineAuthCache): Promise<boolean> {
  if (cache.passwordVerifier) {
    return bcrypt.compare(password, cache.passwordVerifier);
  }
  if (cache.password) {
    return cache.password === password;
  }
  return false;
}

export function readOfflineAuthCache(storage: Storage | null | undefined): OfflineAuthCache | null {
  if (!canUseStorage(storage)) return null;
  try {
    const raw = storage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineAuthCache | LegacyOfflineAuthCache;
    if (!parsed?.username || !parsed?.user) return null;
    if (!parsed.passwordVerifier && !parsed.password) return null;
    return parsed as OfflineAuthCache;
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
