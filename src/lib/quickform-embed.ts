/** Dashboard iframe quickforms (?embed=1). */

export function getEmbedFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

/** Preserve embed=1 when clearing create/prefill params (read URL directly — hook may lag). */
export function getEmbedQuickformPath(pathname: string): string {
  if (!getEmbedFromLocation()) return pathname;
  return `${pathname}?embed=1`;
}

export function wantsQuickformCreate(search: URLSearchParams | { get: (k: string) => string | null }): boolean {
  if (search.get("embed") !== "1") return false;
  const create = search.get("create");
  return create === "1" || create === "payment";
}
