import { getSyncedModuleData } from "@/lib/offline-full-sync";

type LedgerRow = {
  date: string;
  type: string;
  reference: string;
  productId: number;
  productName: string;
  godownId: number;
  godownName: string;
  cityName: string;
  qtyIn: number;
  qtyOut: number;
  runningStock?: number;
  customerName?: string | null;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dateOnly(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function inDateRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function matchesGodown(godownId: number, filter?: number): boolean {
  return !filter || godownId === filter;
}

function matchesProduct(productId: number, filter?: number): boolean {
  return !filter || productId === filter;
}

/** Approximate stock ledger rows from full-sync modules (offline fallback). */
export async function buildOfflineStockLedger(params?: Record<string, string | number | undefined>): Promise<LedgerRow[]> {
  const [openingStocks, lots, sales, godownTransfers, cityTransfers, godowns, products] = await Promise.all([
    getSyncedModuleData("openingStocks"),
    getSyncedModuleData("lots"),
    getSyncedModuleData("sales"),
    getSyncedModuleData("godownTransfers"),
    getSyncedModuleData("cityTransfers"),
    getSyncedModuleData("godowns"),
    getSyncedModuleData("products"),
  ]);
  return buildOfflineStockLedgerFromModules(
    { openingStocks, lots, sales, godownTransfers, cityTransfers, godowns, products },
    params
  );
}

export function buildOfflineStockLedgerFromModules(
  modules: {
    openingStocks?: unknown;
    lots?: unknown;
    sales?: unknown;
    godownTransfers?: unknown;
    cityTransfers?: unknown;
    godowns?: unknown;
    products?: unknown;
  },
  params?: Record<string, string | number | undefined>
): LedgerRow[] {
  const godownFilter = Number(params?.godown_id || 0) || undefined;
  const productFilter = Number(params?.product_id || 0) || undefined;
  const dateFrom = params?.date_from ? String(params.date_from) : undefined;
  const dateTo = params?.date_to ? String(params.date_to) : undefined;

  const openingStocks = modules.openingStocks;
  const lots = modules.lots;
  const sales = modules.sales;
  const godownTransfers = modules.godownTransfers;
  const cityTransfers = modules.cityTransfers;
  const godowns = modules.godowns;
  const products = modules.products;

  const godownNameById = new Map<number, string>();
  for (const g of asArray(godowns)) {
    const row = g as { id?: number; name?: string };
    if (row.id) godownNameById.set(Number(row.id), String(row.name || ""));
  }
  const productNameById = new Map<number, string>();
  for (const p of asArray(products)) {
    const row = p as { id?: number; name?: string };
    if (row.id) productNameById.set(Number(row.id), String(row.name || ""));
  }

  const rows: LedgerRow[] = [];

  for (const os of asArray(openingStocks)) {
    const row = os as {
      openingDate?: string;
      godownId?: number;
      productId?: number;
      qty?: number;
      godown?: { id?: number; name?: string };
      product?: { id?: number; name?: string };
    };
    const godownId = Number(row.godownId ?? row.godown?.id ?? 0);
    const productId = Number(row.productId ?? row.product?.id ?? 0);
    if (!matchesGodown(godownId, godownFilter) || !matchesProduct(productId, productFilter)) continue;
    const date = dateOnly(row.openingDate);
    if (!inDateRange(date, dateFrom, dateTo)) continue;
    rows.push({
      date,
      type: "opening",
      reference: "OPEN",
      productId,
      productName: row.product?.name ?? productNameById.get(productId) ?? "",
      godownId,
      godownName: row.godown?.name ?? godownNameById.get(godownId) ?? "",
      cityName: "",
      qtyIn: Number(row.qty || 0),
      qtyOut: 0,
    });
  }

  for (const lot of asArray(lots)) {
    const lotRow = lot as { lotNumber?: string; distributions?: unknown[] };
    for (const dist of asArray(lotRow.distributions)) {
      const d = dist as {
        productId?: number;
        productName?: string;
        godownAllocations?: unknown[];
      };
      const productId = Number(d.productId || 0);
      if (!matchesProduct(productId, productFilter)) continue;
      for (const ga of asArray(d.godownAllocations)) {
        const alloc = ga as { godownId?: number; godownName?: string; qty?: number };
        const godownId = Number(alloc.godownId || 0);
        if (!matchesGodown(godownId, godownFilter)) continue;
        const date = dateOnly((lot as { lotDate?: string }).lotDate);
        if (!inDateRange(date, dateFrom, dateTo)) continue;
        rows.push({
          date,
          type: "allocation",
          reference: String(lotRow.lotNumber || "LOT"),
          productId,
          productName: d.productName ?? productNameById.get(productId) ?? "",
          godownId,
          godownName: alloc.godownName ?? godownNameById.get(godownId) ?? "",
          cityName: "",
          qtyIn: Number(alloc.qty || 0),
          qtyOut: 0,
        });
      }
    }
  }

  for (const sale of asArray(sales)) {
    const s = sale as {
      status?: string;
      voucherNo?: string;
      saleDate?: string;
      date?: string;
      godownId?: number;
      customer?: { name?: string };
      customerName?: string;
      items?: unknown[];
    };
    if (!["active", "marked_short"].includes(String(s.status || ""))) continue;
    const date = dateOnly(s.saleDate ?? s.date);
    if (!inDateRange(date, dateFrom, dateTo)) continue;
    const godownId = Number(s.godownId || 0);
    if (godownFilter && godownId !== godownFilter) continue;
    for (const item of asArray(s.items)) {
      const si = item as { productId?: number; qty?: number; product?: { name?: string } };
      const productId = Number(si.productId || 0);
      if (!matchesProduct(productId, productFilter)) continue;
      rows.push({
        date,
        type: "sale",
        reference: String(s.voucherNo || "SALE"),
        productId,
        productName: si.product?.name ?? productNameById.get(productId) ?? "",
        godownId,
        godownName: godownNameById.get(godownId) ?? "",
        cityName: "",
        qtyIn: 0,
        qtyOut: Number(si.qty || 0),
        customerName: s.customer?.name ?? s.customerName ?? null,
      });
    }
  }

  for (const gt of asArray(godownTransfers)) {
    const t = gt as {
      transferDate?: string;
      qty?: number;
      productId?: number;
      fromGodownId?: number;
      toGodownId?: number;
      fromGodown?: { id?: number; name?: string };
      toGodown?: { id?: number; name?: string };
      product?: { id?: number; name?: string };
      lot?: { lotNumber?: string };
    };
    const date = dateOnly(t.transferDate);
    if (!inDateRange(date, dateFrom, dateTo)) continue;
    const productId = Number(t.productId ?? t.product?.id ?? 0);
    if (!matchesProduct(productId, productFilter)) continue;
    const ref = t.lot?.lotNumber ? String(t.lot.lotNumber) : "GTX";
    const qty = Number(t.qty || 0);
    const fromId = Number(t.fromGodownId ?? t.fromGodown?.id ?? 0);
    const toId = Number(t.toGodownId ?? t.toGodown?.id ?? 0);
    const productName = t.product?.name ?? productNameById.get(productId) ?? "";

    if (matchesGodown(fromId, godownFilter)) {
      rows.push({
        date,
        type: "godown_transfer",
        reference: ref,
        productId,
        productName,
        godownId: fromId,
        godownName: t.fromGodown?.name ?? godownNameById.get(fromId) ?? "",
        cityName: "",
        qtyIn: 0,
        qtyOut: qty,
      });
    }
    if (matchesGodown(toId, godownFilter)) {
      rows.push({
        date,
        type: "godown_transfer",
        reference: ref,
        productId,
        productName,
        godownId: toId,
        godownName: t.toGodown?.name ?? godownNameById.get(toId) ?? "",
        cityName: "",
        qtyIn: qty,
        qtyOut: 0,
      });
    }
  }

  for (const ct of asArray(cityTransfers)) {
    const tr = ct as {
      status?: string;
      transferDate?: string;
      qty?: number;
      productId?: number;
      toGodownId?: number;
      fromGodownId?: number;
      product?: { id?: number; name?: string };
    };
    if (String(tr.status || "") !== "approved") continue;
    const date = dateOnly(tr.transferDate);
    if (!inDateRange(date, dateFrom, dateTo)) continue;
    const productId = Number(tr.productId ?? tr.product?.id ?? 0);
    if (!matchesProduct(productId, productFilter)) continue;
    const qty = Number(tr.qty || 0);
    const toId = Number(tr.toGodownId || 0);
    const fromId = Number(tr.fromGodownId || 0);
    const productName = tr.product?.name ?? productNameById.get(productId) ?? "";
    if (matchesGodown(toId, godownFilter)) {
      rows.push({
        date,
        type: "city_transfer",
        reference: "CTIN",
        productId,
        productName,
        godownId: toId,
        godownName: godownNameById.get(toId) ?? "",
        cityName: "",
        qtyIn: qty,
        qtyOut: 0,
      });
    }
    if (matchesGodown(fromId, godownFilter)) {
      rows.push({
        date,
        type: "city_transfer",
        reference: "CTOUT",
        productId,
        productName,
        godownId: fromId,
        godownName: godownNameById.get(fromId) ?? "",
        cityName: "",
        qtyIn: 0,
        qtyOut: qty,
      });
    }
  }

  rows.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.reference.localeCompare(b.reference);
  });

  let running = 0;
  for (const row of rows) {
    running += row.qtyIn - row.qtyOut;
    row.runningStock = Math.round(running * 100) / 100;
  }

  const limit = Math.max(1, Number(params?.limit || 500) || 500);
  return rows.reverse().slice(0, limit);
}
