export const OFFLINE_AUTH_CACHE_KEY = "mrf-offline-auth-cache-v1";

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
  password: string;
  user: OfflineAuthUser;
  updatedAt: string;
}

function canUseStorage(storage: Storage | null | undefined): storage is Storage {
  return !!storage;
}

export function readOfflineAuthCache(storage: Storage | null | undefined): OfflineAuthCache | null {
  if (!canUseStorage(storage)) return null;
  try {
    const raw = storage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineAuthCache;
    if (!parsed?.username || !parsed?.password || !parsed?.user) return null;
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
