const OFFLINE_WRITE_QUEUE_ALLOWLIST = [
  "/api/v1/sales",
  "/api/v1/payments",
  "/api/v1/expenses",
  "/api/v1/personal-withdrawals",
  "/api/v1/haji-transfers",
  "/api/v1/customers",
  "/api/v1/bank-deposits",
  "/api/v1/suppliers",
  "/api/v1/intermediaries",
  "/api/v1/supplier-payments",
  "/api/v1/shipping-line-payments",
  "/api/v1/super-admin-personal-expenses",
  "/api/v1/agent-payments",
  "/api/v1/lot-costs",
  "/api/v1/openings",
  "/api/v1/lots",
  "/api/v1/lot-purchases",
  "/api/v1/products",
  "/api/v1/users",
  "/api/v1/shipping-lines",
  "/api/v1/agents",
  "/api/v1/bank-accounts",
  "/api/v1/city-transfers",
  "/api/v1/godowns",
  "/api/v1/godowns/transfers",
  "/api/v1/investors",
  "/api/v1/super-admin-account-transfers",
] as const;

const OFFLINE_WRITE_QUEUE_DYNAMIC_ALLOWLIST = [
  /^\/api\/v1\/intermediaries\/\d+\/deposits$/,
  /^\/api\/v1\/intermediaries\/\d+\/exchanges$/,
  /^\/api\/v1\/investors\/\d+\/transactions$/,
];

const OFFLINE_MUTATION_EXTRA_PATTERNS = [
  /^\/api\/v1\/investors\/\d+$/,
  /^\/api\/v1\/investors\/\d+\/transactions\/\d+$/,
] as const;

const OFFLINE_QUEUE_BLOCKED_PREFIXES = [
  "/api/v1/auth/",
  "/api/v1/offline/",
  "/api/v1/activity-feed",
  "/api/v1/search",
  "/api/v1/analytics",
  "/api/v1/dashboard",
  "/api/v1/cash-position",
  "/api/v1/treasury",
  "/api/v1/inventory",
  "/api/v1/sessions",
  "/api/v1/godown-permissions",
  "/api/v1/assistant",
  "/api/v1/delivery",
  "/api/v1/liabilities",
  "/api/v1/super-admin-liabilities",
  "/api/v1/health",
  "/api/ping",
] as const;

// Delivery routes are intentionally online-only because they manage credentials,
// assignments, and actions that require an immediate authoritative server check.
// Liability routes are intentionally online-only until every entry route has
// transactional sync-request idempotency; retries must never duplicate debt.

export function isOfflineQueueBlockedPath(path: string): boolean {
  return OFFLINE_QUEUE_BLOCKED_PREFIXES.some((blocked) => {
    if (blocked.endsWith("/")) return path.startsWith(blocked);
    return path === blocked || path.startsWith(`${blocked}/`);
  });
}

export function isAllowlistedOfflineMutationPath(path: string): boolean {
  if (isOfflineQueueBlockedPath(path)) return false;
  if (OFFLINE_WRITE_QUEUE_ALLOWLIST.includes(path as (typeof OFFLINE_WRITE_QUEUE_ALLOWLIST)[number])) return true;
  if (OFFLINE_MUTATION_EXTRA_PATTERNS.some((pattern) => pattern.test(path))) return true;
  for (const base of OFFLINE_WRITE_QUEUE_ALLOWLIST) {
    if (path.startsWith(`${base}/`)) return true;
  }
  return OFFLINE_WRITE_QUEUE_DYNAMIC_ALLOWLIST.some((pattern) => pattern.test(path));
}
