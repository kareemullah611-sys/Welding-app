import { readOfflineAuthCache } from "@/lib/offline-auth-cache";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getCachedGodownStockFromDb } from "@/lib/offline-inventory";
import { searchOfflineSyncedModules } from "@/lib/offline-local-search";
import { buildOfflineStockLedger } from "@/lib/offline-stock-ledger";
import { buildOfflineLotProfitReport } from "@/lib/offline-lot-profit";

const DASHBOARD_READ_CACHE_KEY = "mrf-dashboard-read-cache-v1";
const INVENTORY_READ_CACHE_KEY = "mrf-inventory-read-cache-v1";
const ANALYTICS_READ_CACHE_KEY = "mrf-analytics-read-cache-v1";
const PROFIT_REPORT_READ_CACHE_KEY = "mrf-profit-report-read-cache-v1";
const SEARCH_READ_CACHE_KEY = "mrf-search-read-cache-v1";

type DashboardReadSnapshot = {
  data: unknown | null;
  cashPosition: unknown | null;
  treasury: unknown | null;
};

type InventoryReadSnapshot = {
  data: unknown | null;
  pendingTransfers: unknown[];
  lots: unknown[];
  ledger: unknown[];
  godownList: unknown[];
  productList: unknown[];
};

type AnalyticsReadSnapshot = {
  cities: unknown[];
  chartData: unknown[];
  totals: unknown | null;
  period: string;
  year: number;
  from: string;
  to: string;
  cityId: number;
};

type ProfitReportReadSnapshot = {
  lots: unknown[];
  data: unknown | null;
  mode: "lot" | "period";
  selectedLotId: number;
  year: number;
};

function normalizeApiPath(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).pathname;
    } catch {
      return raw;
    }
  }
  return raw.split("?")[0] || raw;
}

/** Serve aggregate GET endpoints from local read snapshots (post-sync prefetch). */
export function getOfflineAggregateForApiRequest<T = unknown>(
  url: string,
  params?: Record<string, string | number | undefined>
): { data: T } | null {
  if (typeof window === "undefined") return null;
  const path = normalizeApiPath(url);

  if (path === "/api/v1/dashboard" || path === "/api/v1/cash-position" || path === "/api/v1/treasury") {
    const snap = readOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY);
    if (!snap?.data) return null;
    if (path === "/api/v1/dashboard" && snap.data.data) return { data: snap.data.data as T };
    if (path === "/api/v1/cash-position" && snap.data.cashPosition) return { data: snap.data.cashPosition as T };
    if (path === "/api/v1/treasury" && snap.data.treasury) return { data: snap.data.treasury as T };
    return null;
  }

  if (path === "/api/v1/inventory") {
    const snap = readOfflineReadSnapshot<InventoryReadSnapshot>(INVENTORY_READ_CACHE_KEY);
    if (snap?.data?.data) return { data: snap.data.data as T };
  }

  if (path === "/api/v1/analytics") {
    const snap = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY);
    if (!snap?.data?.chartData?.length) return null;
    const cached = snap.data;
    const reqPeriod = String(params?.period || "monthly");
    const reqYear = Number(params?.year || new Date().getFullYear());
    if (cached.period === reqPeriod && cached.year === reqYear) {
      return {
        data: {
          chartData: cached.chartData,
          totals: cached.totals,
        } as T,
      };
    }
    // Fall back to any cached analytics snapshot
    return {
      data: {
        chartData: cached.chartData,
        totals: cached.totals,
      } as T,
    };
  }

  if (path === "/api/v1/profit-report") {
    const snap = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY);
    if (!snap?.data?.data) return null;
    const cached = snap.data;
    if (params?.lot_id) {
      if (cached.mode === "lot" && Number(params.lot_id) === Number(cached.selectedLotId)) {
        return { data: cached.data as T };
      }
      return null;
    }
    if (params?.year && cached.mode === "period") {
      if (Number(params.year) === Number(cached.year)) return { data: cached.data as T };
      return { data: cached.data as T };
    }
    if (!params?.lot_id && cached.mode === "period") return { data: cached.data as T };
    return null;
  }

  if (path === "/api/v1/search") {
    const snap = readOfflineReadSnapshot<{
      cities: unknown[];
      results: unknown;
      query: string;
      type: string;
      cityId?: number;
    }>(SEARCH_READ_CACHE_KEY);
    if (snap?.data?.results && params?.q && String(params.q).length >= 2) {
      if (
        String(snap.data.query || "") === String(params.q) &&
        String(snap.data.type || "all") === String(params.type || "all")
      ) {
        return { data: snap.data.results as T };
      }
    }
    return null;
  }

  return null;
}

/** Async offline reads that need IndexedDB or full-sync modules. */
export async function getOfflineSpecialApiRequest<T = unknown>(
  url: string,
  params?: Record<string, string | number | undefined>
): Promise<{ data: T } | null> {
  const path = normalizeApiPath(url);

  if (path === "/api/v1/profit-report" && params?.lot_id) {
    const data = await buildOfflineLotProfitReport(Number(params.lot_id));
    if (data) return { data: data as T };
    return null;
  }

  if (path === "/api/v1/inventory/stock-ledger") {
    const rows = await buildOfflineStockLedger(params);
    if (rows.length) return { data: rows as T };
    return { data: [] as T };
  }

  if (path === "/api/v1/inventory/godown-stock") {
    const godownId = Number(params?.godown_id || 0);
    if (!godownId) return null;
    const stock = await getCachedGodownStockFromDb(godownId);
    if (stock) return { data: stock as T };
    return null;
  }

  if (path === "/api/v1/search" && params?.q && String(params.q).length >= 2) {
    const results = await searchOfflineSyncedModules({
      q: String(params.q),
      type: String(params.type || "all"),
      city_id: params.city_id,
    });
    if (results) return { data: results as T };
  }

  return null;
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(path, { credentials: "include", signal: controller.signal });
    clearTimeout(timeout);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** After full sync, prefetch heavy aggregate pages so packaged users never need to visit them first. */
export async function prefetchOfflineAggregateSnapshots(): Promise<void> {
  if (typeof window === "undefined") return;

  const cachedUser = readOfflineAuthCache(window.localStorage)?.user;
  const isCityAdmin = cachedUser?.role === "city_admin";
  const year = new Date().getFullYear();

  const [dashboard, cashPosition, inventory, treasury, analytics, profitReport, cities, lots] = await Promise.all([
    fetchJson("/api/v1/dashboard"),
    fetchJson("/api/v1/cash-position"),
    fetchJson("/api/v1/inventory"),
    isCityAdmin ? fetchJson("/api/v1/treasury") : Promise.resolve(null),
    fetchJson(`/api/v1/analytics?period=monthly&year=${year}`),
    fetchJson(`/api/v1/profit-report?year=${year}`),
    cachedUser?.role === "super_admin" ? fetchJson("/api/v1/cities") : Promise.resolve(null),
    fetchJson("/api/v1/lots?limit=100"),
  ]);

  const existingDash = readOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY)?.data;
  if (dashboard || cashPosition || treasury) {
    writeOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY, {
      data: dashboard ?? existingDash?.data ?? null,
      cashPosition: cashPosition ?? existingDash?.cashPosition ?? null,
      treasury: treasury ?? existingDash?.treasury ?? null,
    });
  }

  const existingInv = readOfflineReadSnapshot<InventoryReadSnapshot>(INVENTORY_READ_CACHE_KEY)?.data;
  if (inventory) {
    writeOfflineReadSnapshot<InventoryReadSnapshot>(INVENTORY_READ_CACHE_KEY, {
      data: inventory,
      pendingTransfers: existingInv?.pendingTransfers ?? [],
      lots: existingInv?.lots ?? [],
      ledger: existingInv?.ledger ?? [],
      godownList: existingInv?.godownList ?? [],
      productList: existingInv?.productList ?? [],
    });
  }

  if (analytics) {
    const analyticsData = analytics as { chartData?: unknown[]; totals?: unknown };
    const existing = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
    writeOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY, {
      cities: (cities as unknown[]) ?? existing?.cities ?? [],
      chartData: analyticsData.chartData ?? [],
      totals: analyticsData.totals ?? null,
      period: "monthly",
      year,
      from: "",
      to: "",
      cityId: 0,
    });
  } else if (cities) {
    const existing = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
    writeOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY, {
      cities: cities as unknown[],
      chartData: existing?.chartData ?? [],
      totals: existing?.totals ?? null,
      period: existing?.period ?? "monthly",
      year: existing?.year ?? year,
      from: existing?.from ?? "",
      to: existing?.to ?? "",
      cityId: existing?.cityId ?? 0,
    });
  }

  if (profitReport) {
    const existing = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
    writeOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY, {
      lots: (lots as unknown[]) ?? existing?.lots ?? [],
      data: profitReport,
      mode: "period",
      selectedLotId: 0,
      year,
    });
  } else if (lots) {
    const existing = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
    writeOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY, {
      lots: lots as unknown[],
      data: existing?.data ?? null,
      mode: existing?.mode ?? "period",
      selectedLotId: existing?.selectedLotId ?? 0,
      year: existing?.year ?? year,
    });
  }

  if (cities) {
    const existing = readOfflineReadSnapshot<{ cities: unknown[]; results: unknown; query: string; type: string }>(
      SEARCH_READ_CACHE_KEY
    )?.data;
    writeOfflineReadSnapshot(SEARCH_READ_CACHE_KEY, {
      cities: cities as unknown[],
      results: existing?.results ?? null,
      query: existing?.query ?? "",
      type: existing?.type ?? "all",
    });
  }
}
