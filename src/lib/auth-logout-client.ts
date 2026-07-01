/** Set on logout so login page skips auto-redirect until session cookie is cleared. */
export const AUTH_LOGOUT_FLAG = "mrf-auth-logout";

const LOGOUT_FLAG_MAX_AGE_MS = 30_000;

export function markAuthLogoutPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AUTH_LOGOUT_FLAG, String(Date.now()));
}

export function isAuthLogoutPending(): boolean {
  if (typeof window === "undefined") return false;
  const raw = sessionStorage.getItem(AUTH_LOGOUT_FLAG);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || Date.now() - ts > LOGOUT_FLAG_MAX_AGE_MS) {
    sessionStorage.removeItem(AUTH_LOGOUT_FLAG);
    return false;
  }
  return true;
}

export function clearAuthLogoutPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(AUTH_LOGOUT_FLAG);
}
