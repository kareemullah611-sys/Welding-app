/** Dashboard iframe quickforms (?embed=1). */

export const QUICKFORM_POST_MESSAGE = {
  close: "dashboard-quick-close",
  reload: "dashboard-quickform-reload",
} as const;

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
