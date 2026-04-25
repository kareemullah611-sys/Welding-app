export function getLockedCityNames(): string[] {
  const raw = String(process.env.CITY_LOCK_NAMES || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

export function isCityLockedDeployment(): boolean {
  return getLockedCityNames().length > 0;
}

export function isAllowedCityName(cityName: string | null | undefined): boolean {
  const locks = getLockedCityNames();
  if (locks.length === 0) return true;
  const normalized = String(cityName || "").trim().toLowerCase();
  return locks.includes(normalized);
}

export function allowSuperAdminInLockedDeployment(): boolean {
  return String(process.env.CITY_LOCK_ALLOW_SUPER_ADMIN || "").trim().toLowerCase() === "true";
}
