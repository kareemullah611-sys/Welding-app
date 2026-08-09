export type AppBranding = {
  systemName: string;
  logoUrl: string | null;
};

export const DEFAULT_APP_BRANDING: AppBranding = {
  systemName: "MRF Hardware",
  logoUrl: null,
};

export const APP_BRANDING_CACHE_KEY = "mrf-app-branding-v1";
export const APP_BRANDING_UPDATED_EVENT = "app-branding-updated";

export function normalizeAppBranding(value: unknown): AppBranding {
  const data = value && typeof value === "object" ? (value as Partial<AppBranding>) : {};
  const systemName =
    typeof data.systemName === "string" && data.systemName.trim()
      ? data.systemName.trim()
      : DEFAULT_APP_BRANDING.systemName;
  const logoUrl =
    typeof data.logoUrl === "string" && data.logoUrl.trim()
      ? data.logoUrl.trim()
      : null;
  return { systemName, logoUrl };
}
