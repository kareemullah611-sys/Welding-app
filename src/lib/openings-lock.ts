/** When true, city admins cannot POST opening entries; super_admin still can. */
export function isOpeningsLocked(): boolean {
  return String(process.env.OPENINGS_LOCKED || "").toLowerCase() === "true";
}

export function canEditOpenings(role: string | undefined): boolean {
  if (!isOpeningsLocked()) return true;
  return role === "super_admin";
}
