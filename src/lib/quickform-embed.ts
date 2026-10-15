/** Dashboard iframe quickforms (?embed=1). */

import { isCapacitorRuntime } from "@/lib/packaged-api";

export const QUICKFORM_POST_MESSAGE = {
  close: "dashboard-quick-close",
  reload: "dashboard-quickform-reload",
} as const;

/**
 * URL for the dashboard quickform iframe.
 *
 * On Capacitor the app is a static export served through WebViewAssetHandler,
 * whose router (Router.swift) maps every extensionless path to the *root*
 * index.html. A quickform iframe is a real document load, so "/sales" would be
 * served the login page instead of the module. Pointing at the exported file
 * resolves correctly, and Next's client router normalises the pathname back to
 * the route. Web/Electron run a real server that already routes "/sales".
 */
export function getQuickformSrc(route: string, create: string): string {
  const query = `create=${create}&embed=1`;
  return isCapacitorRuntime() ? `/${route}/index.html?${query}` : `/${route}?${query}`;
}

export function getEmbedFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

/** Preserve embed=1 when clearing create/prefill params (read URL directly — hook may lag). */
export function getEmbedQuickformPath(pathname: string): string {
  if (typeof window === "undefined") return pathname;
  const embedded =
    new URLSearchParams(window.location.search).get("embed") === "1" ||
    getEmbedFromLocation();
  if (!embedded) return pathname;
  return `${pathname}?embed=1`;
}

export function wantsQuickformCreate(search: URLSearchParams | { get: (k: string) => string | null }): boolean {
  if (search.get("embed") !== "1") return false;
  const create = search.get("create");
  return create === "1" || create === "payment";
}

/** Compact modal copy for PK/AFG city admins and dashboard quickforms. */
export function shouldSimplifyCityModals(
  user: { role?: string; countryName?: string | null } | null | undefined,
  isEmbed = false,
): boolean {
  if (isEmbed) return true;
  return (
    user?.role === "city_admin" &&
    (user.countryName === "Pakistan" || user.countryName === "Afghanistan")
  );
}
