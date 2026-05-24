import { getSyncedModuleData } from "@/lib/offline-full-sync";
import { readOfflineAuthCache } from "@/lib/offline-auth-cache";

const TAKE = 10;

type SearchParams = {
  q: string;
  type?: string;
  city_id?: string | number;
};

function includesQuery(value: unknown, q: string): boolean {
  if (value === null || value === undefined) return false;
  return String(value).toLowerCase().includes(q);
}

function rowMatchesQuery(row: Record<string, unknown>, q: string, fields: string[]): boolean {
  for (const field of fields) {
    if (includesQuery(row[field], q)) return true;
  }
  return JSON.stringify(row).toLowerCase().includes(q);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cityFilter(row: Record<string, unknown>, cityId: number | null): boolean {
  if (!cityId) return true;
  const rowCityId = Number(row.cityId ?? row.city_id ?? (row.city as { id?: number })?.id ?? 0);
  return rowCityId === cityId;
}

function mapCustomers(rows: unknown[], q: string, cityId: number | null) {
  return asArray(rows)
    .filter((row) => cityFilter(row as Record<string, unknown>, cityId))
    .filter((row) => rowMatchesQuery(row as Record<string, unknown>, q, ["name", "phone", "area"]))
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        name: r.name,
        city: (r.city as { name?: string })?.name ?? r.cityName ?? "",
        phone: r.phone ?? "",
      };
    });
}

function mapSales(rows: unknown[], q: string, cityId: number | null) {
  return asArray(rows)
    .filter((row) => cityFilter(row as Record<string, unknown>, cityId))
    .filter((row) =>
      rowMatchesQuery(row as Record<string, unknown>, q, [
        "voucherNo",
        "customerName",
        "notes",
        "manualVoucherNo",
      ])
    )
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        voucherNo: r.voucherNo ?? r.manualVoucherNo,
        customer: r.customerName ?? (r.customer as { name?: string })?.name ?? "",
        amount: Number(r.totalAmount ?? r.amount ?? 0),
        currency: (r.currency as { code?: string })?.code ?? r.currencyCode ?? "",
        date: String(r.saleDate ?? r.date ?? "").slice(0, 10),
        status: r.status,
      };
    });
}

function mapPayments(rows: unknown[], q: string, cityId: number | null) {
  return asArray(rows)
    .filter((row) => cityFilter(row as Record<string, unknown>, cityId))
    .filter((row) =>
      rowMatchesQuery(row as Record<string, unknown>, q, [
        "detail",
        "manualVoucherNo",
        "customerName",
      ])
    )
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        detail: r.detail,
        customer: r.customerName ?? (r.customer as { name?: string })?.name ?? "",
        amount: Number(r.amount ?? 0),
        currency: (r.currency as { code?: string })?.code ?? r.currencyCode ?? "",
        date: String(r.paymentDate ?? r.date ?? "").slice(0, 10),
        status: r.status,
      };
    });
}

function mapLots(rows: unknown[], q: string, cityId: number | null, countryId: number | null) {
  return asArray(rows)
    .filter((row) => {
      const r = row as Record<string, unknown>;
      if (cityId) {
        const distributions = asArray(r.lotCityDistributions ?? r.distributions);
        if (distributions.some((d) => Number((d as { cityId?: number }).cityId) === cityId)) return true;
        if (countryId && Number(r.countryId) !== countryId) return false;
      }
      return true;
    })
    .filter((row) => rowMatchesQuery(row as Record<string, unknown>, q, ["lotNumber", "notes"]))
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        lotNumber: r.lotNumber,
        country: (r.country as { name?: string })?.name ?? r.countryName ?? "",
        date: String(r.lotDate ?? r.date ?? "").slice(0, 10),
        status: r.status,
      };
    });
}

function mapProducts(rows: unknown[], q: string) {
  return asArray(rows)
    .filter((row) => rowMatchesQuery(row as Record<string, unknown>, q, ["name"]))
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { id: r.id, name: r.name, isActive: r.isActive ?? true };
    });
}

function mapHajiTransfers(rows: unknown[], q: string, cityId: number | null) {
  return asArray(rows)
    .filter((row) => cityFilter(row as Record<string, unknown>, cityId))
    .filter((row) => rowMatchesQuery(row as Record<string, unknown>, q, ["detail", "notes"]))
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        detail: r.detail,
        amount: Number(r.amount ?? 0),
        currency: (r.currency as { code?: string })?.code ?? r.currencyCode ?? "",
        date: String(r.transferDate ?? r.date ?? "").slice(0, 10),
        transferType: r.transferType,
        lotNumber: (r.lot as { lotNumber?: string })?.lotNumber ?? r.lotNumber ?? "",
        city: (r.city as { name?: string })?.name ?? r.cityName ?? "",
      };
    });
}

function mapExpenses(rows: unknown[], q: string, cityId: number | null) {
  return asArray(rows)
    .filter((row) => cityFilter(row as Record<string, unknown>, cityId))
    .filter((row) => rowMatchesQuery(row as Record<string, unknown>, q, ["detail", "notes"]))
    .slice(0, TAKE)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        detail: r.detail,
        amount: Number(r.amount ?? 0),
        currency: (r.currency as { code?: string })?.code ?? r.currencyCode ?? "",
        date: String(r.expenseDate ?? r.date ?? "").slice(0, 10),
        lotNumber: (r.lot as { lotNumber?: string })?.lotNumber ?? r.lotNumber ?? "",
        city: (r.city as { name?: string })?.name ?? r.cityName ?? "",
      };
    });
}

/** Client-side search over full-sync module rows (pure — easy to test). */
export function buildOfflineSearchResults(
  modules: {
    customers?: unknown;
    sales?: unknown;
    payments?: unknown;
    lots?: unknown;
    products?: unknown;
    hajiTransfers?: unknown;
    expenses?: unknown;
  },
  params: SearchParams & { scopedCityId?: number | null; countryId?: number | null }
): Record<string, unknown[]> {
  const q = String(params.q || "").trim().toLowerCase();
  if (q.length < 2) return {};

  const type = String(params.type || "all");
  const scopedCityId = params.scopedCityId ?? (
    params.city_id !== undefined && params.city_id !== "" ? Number(params.city_id) : null
  );
  const countryId = params.countryId ?? null;

  const results: Record<string, unknown[]> = {};
  if (type === "all" || type === "customers") {
    results.customers = mapCustomers(asArray(modules.customers), q, scopedCityId);
  }
  if (type === "all" || type === "sales") {
    results.sales = mapSales(asArray(modules.sales), q, scopedCityId);
  }
  if (type === "all" || type === "payments") {
    results.payments = mapPayments(asArray(modules.payments), q, scopedCityId);
  }
  if (type === "all" || type === "lots") {
    results.lots = mapLots(asArray(modules.lots), q, scopedCityId, countryId);
  }
  if (type === "all" || type === "products") {
    results.products = mapProducts(asArray(modules.products), q);
  }
  if (type === "all" || type === "haji_transfers") {
    results.haji_transfers = mapHajiTransfers(asArray(modules.hajiTransfers), q, scopedCityId);
  }
  if (type === "all" || type === "expenses") {
    results.expenses = mapExpenses(asArray(modules.expenses), q, scopedCityId);
  }
  return results;
}

/** Client-side search over full-sync modules when the server is unreachable. */
export async function searchOfflineSyncedModules(
  params: SearchParams
): Promise<Record<string, unknown[]> | null> {
  const q = String(params.q || "").trim().toLowerCase();
  if (q.length < 2) return null;

  const cachedUser = typeof window !== "undefined"
    ? readOfflineAuthCache(window.localStorage)?.user
    : null;
  const cityId = params.city_id !== undefined && params.city_id !== ""
    ? Number(params.city_id)
    : null;
  const scopedCityId = cachedUser?.role === "city_admin" ? (cachedUser.cityId ?? cityId) : cityId;

  const [customers, sales, payments, lots, products, hajiTransfers, expenses] = await Promise.all([
    getSyncedModuleData("customers"),
    getSyncedModuleData("sales"),
    getSyncedModuleData("payments"),
    getSyncedModuleData("lots"),
    getSyncedModuleData("products"),
    getSyncedModuleData("hajiTransfers"),
    getSyncedModuleData("expenses"),
  ]);

  return buildOfflineSearchResults(
    { customers, sales, payments, lots, products, hajiTransfers, expenses },
    { ...params, scopedCityId, countryId: cachedUser?.countryId ?? null }
  );
}
