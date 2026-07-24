"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatusBadge, formatCurrency, formatDate, RowActionMenu, MobileDateInput } from "@/components/ui";
import CustomerFieldWithNew from "@/components/CustomerFieldWithNew";
import { useLang } from "@/lib/lang";
import { safeParseQueuedBody } from "@/lib/queue-resolve";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getEmbedQuickformPath, shouldSimplifyCityModals } from "@/lib/quickform-embed";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { LedgerExportButtons } from "@/components/LedgerExportButtons";
import { formatCurrencySelectLabel } from "@/lib/city-money-format";

const SALES_FORM_CACHE_KEY = "mrf-sales-form-cache-v1";
const SALES_READ_CACHE_KEY = "mrf-sales-read-cache-v1";

type SalesReadSnapshot = {
  sales: any[];
  totalPages: number;
  total: number;
};

type SalesFormCache = {
  godowns: any[];
  products: any[];
  lots: any[];
  currencies: any[];
};

type LatestSaleSummary = {
  pending: boolean;
  voucher: string;
  date: string;
  customer: string;
  amount: string;
  meta: string[];
};

const emptySaleItem = () => ({ productId: 0, lotId: 0, qty: 0, ratePerCarton: 0, ratePerPieceLocal: 0, ratePerPieceUsd: 0 });

function buildLatestSaleSummary(
  sale: any,
  formSnapshot: any,
  customerName: string,
  products: any[],
  godowns: any[],
  lots: any[],
  currencies: any[],
  pending = false,
): LatestSaleSummary {
  const currency = sale?.currency || currencies.find((c: any) => c.id === formSnapshot.currencyId);
  const amountPrefix = currency?.symbol ? `${currency.symbol} ` : currency?.code ? `${currency.code} ` : "";
  const items = Array.isArray(sale?.items) ? sale.items : formSnapshot.items || [];
  const firstItem = items[0] || null;
  const firstProductName = firstItem?.productName || products.find((p: any) => p.id === Number(firstItem?.productId))?.name || "Item";
  const itemCount = items.length;
  const qty = items.reduce((sum: number, item: any) => sum + Number(item.cartonQty ?? item.qty ?? 0), 0);
  const lot = sale?.lot?.lotNumber || lots.find((l: any) => l.id === Number(formSnapshot.lotId))?.lotNumber;
  const godown = sale?.godown?.name || godowns.find((g: any) => g.id === Number(formSnapshot.godownId))?.name;
  const totalAmount = Number(sale?.totalAmount ?? formSnapshot.totalAmount ?? 0);
  const meta = [
    sale?.voucherNo ? `#${sale.voucherNo}` : null,
    lot ? `Lot ${lot}` : null,
    godown || null,
    itemCount > 1 ? `${itemCount} items` : firstProductName,
    qty ? `${qty.toLocaleString("en-US")} ctn` : null,
  ].filter(Boolean) as string[];

  return {
    pending,
    voucher: sale?.voucherNo ? `#${sale.voucherNo}` : "—",
    date: sale?.saleDate || formSnapshot.saleDate || "",
    customer: sale?.customer?.name || customerName || (formSnapshot.customerId === -1 ? "Walk-in Customer" : `Customer #${formSnapshot.customerId}`),
    amount: `${amountPrefix}${totalAmount.toLocaleString("en-US")}`,
    meta,
  };
}

function buildLatestSaleSummaryFromRow(
  sale: any,
  products: any[],
  godowns: any[],
  lots: any[],
  currencies: any[],
): LatestSaleSummary | null {
  if (!sale) return null;
  return buildLatestSaleSummary(
    sale,
    {
      customerId: sale.customerId || 0,
      godownId: sale.godownId || sale.godown?.id || 0,
      lotId: sale.lotId || sale.lot?.id || 0,
      saleDate: sale.saleDate || "",
      currencyId: sale.currencyId || sale.currency?.id || 0,
      totalAmount: sale.totalAmount || 0,
      items: sale.items || [],
    },
    sale.customer?.name || "",
    products,
    godowns,
    lots,
    currencies,
    Boolean(sale._pending),
  );
}

function readSalesFormCache(): SalesFormCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SALES_FORM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SalesFormCache;
    if (!Array.isArray(parsed.godowns) || !Array.isArray(parsed.products) || !Array.isArray(parsed.lots) || !Array.isArray(parsed.currencies)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSalesFormCache(cache: SalesFormCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SALES_FORM_CACHE_KEY, JSON.stringify(cache));
}

function formatInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentMonthDateRange() {
  const today = new Date();
  return {
    from: formatInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: formatInputDate(today),
  };
}

function applyQueuedMutationsToSales(baseSales: any[], queueItems: any[]) {
  if (!Array.isArray(baseSales) || !Array.isArray(queueItems) || queueItems.length === 0) return baseSales;
  let next = [...baseSales];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/sales/")) continue;
    const match = url.match(/^\/api\/v1\/sales\/([^/?#]+)/);
    const saleId = match?.[1];
    if (!saleId) continue;
    if (method === "DELETE") {
      next = next.filter((sale: any) => String(sale?.id || "") !== saleId);
      continue;
    }
    const patch = safeParseQueuedBody(String(q?.body || "")) as any;
    if (url.endsWith("/cancel")) {
      next = next.map((sale: any) =>
        String(sale?.id || "") === saleId
          ? { ...sale, status: "cancelled", cancellationReason: patch?.reason || sale?.cancellationReason, _pending: true }
          : sale
      );
      continue;
    }
    if (url.endsWith("/discount")) {
      next = next.map((sale: any) => {
        if (String(sale?.id || "") !== saleId) return sale;
        const current = Number(sale?.totalAmount || 0);
        const discount = Number(patch?.discountAmount || 0);
        return { ...sale, totalAmount: Math.max(0, current - discount), _pending: true };
      });
      continue;
    }
    if (url.endsWith("/correct")) {
      next = next.map((sale: any) => {
        if (String(sale?.id || "") !== saleId) return sale;
        const correctedTotal = Array.isArray(patch?.items)
          ? patch.items.reduce((sum: number, i: any) => sum + Number(i?.qty || 0) * Number(i?.ratePerCarton || 0), 0)
          : Number(sale?.totalAmount || 0);
        return { ...sale, totalAmount: correctedTotal, _pending: true };
      });
    }
  }
  return next;
}

export default function SalesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = useQuickformEmbed();
  const simplifyModals = shouldSimplifyCityModals(user, isEmbed);
  const { isOnline, enqueue, cacheGodownStock, getCachedGodownStock, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue } = useOffline();
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showCorrect, setShowCorrect] = useState(false);
  const [correctItems, setCorrectItems] = useState<any[]>([]);
  const [correctReason, setCorrectReason] = useState("");
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [filters, setFilters] = useState({ status: "", lot_id: "", date_from: "", date_to: "", query: "" });
  const [dateRangePreset, setDateRangePreset] = useState<"today" | "last7" | "month" | "all" | "custom">("all");
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);
  const [openActionId, setOpenActionId] = useState<number | null>(null);

  // Dropdowns
  const [customers, setCustomers] = useState<any[]>([]);
  const [godowns, setGodowns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [filterLots, setFilterLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);

  // Godown stock - available qty per product in selected godown
  const [godownStock, setGodownStock] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);


  // Form state
  const [form, setForm] = useState({
    customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0],
    currencyId: 0, notes: "",
    items: [emptySaleItem()],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [shortConfirmed, setShortConfirmed] = useState(false);
  const [saleSavedNotice, setSaleSavedNotice] = useState<string | null>(null);
  const [latestCreatedSale, setLatestCreatedSale] = useState<LatestSaleSummary | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [prefillHandled, setPrefillHandled] = useState(false);
  const createRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  // Cancel form
  const [cancelReason, setCancelReason] = useState("");
  // Discount form
  const [discountForm, setDiscountForm] = useState({ discountAmount: 0, notes: "", discountDate: new Date().toISOString().split("T")[0] });

  const persistSalesSnapshot = useCallback((nextSales: any[], nextTotal = total) => {
    writeOfflineReadSnapshot<SalesReadSnapshot>(SALES_READ_CACHE_KEY, {
      sales: nextSales,
      totalPages: totalPages || 1,
      total: nextTotal,
    });
  }, [total, totalPages]);

  const loadSales = useCallback(async () => {
    if (isEmbed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    if (filters.status) params.status = filters.status;
    if (filters.lot_id) params.lot_id = filters.lot_id;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    const normalizedQuery = filters.query.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const result = await apiCall("/api/v1/sales", { params });
    if (result.success) {
      let nextSales = (result.data as any[]) || [];
      const pendingSales = queuedItems
        .filter((q) => q.pathname === "/sales" && q.method === "POST" && q.url === "/api/v1/sales")
        .map((q) => {
          const parsed = safeParseQueuedBody(q.body) as any;
          return {
            id: `pending-${q.id}`,
            voucherNo: "—",
            saleDate: parsed?.saleDate || new Date().toISOString().split("T")[0],
            customer: { name: "..." },
            totalAmount: Array.isArray(parsed?.items)
              ? parsed.items.reduce((sum: number, i: any) => sum + Number(i?.qty || 0) * Number(i?.ratePerCarton || 0), 0)
              : 0,
            status: "pending_sync",
            currency: { code: "" },
            _pending: true,
          };
        });
      nextSales = [...pendingSales, ...nextSales];
      nextSales = applyQueuedMutationsToSales(nextSales, queuedItems as any[]);
      setSales(nextSales);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
      writeOfflineReadSnapshot<SalesReadSnapshot>(SALES_READ_CACHE_KEY, {
        sales: nextSales,
        totalPages: (result.pagination as any)?.totalPages || 1,
        total: (result.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<SalesReadSnapshot>(SALES_READ_CACHE_KEY)?.data;
      if (snapshot?.sales?.length) {
        const activePendingIds = new Set(
          queuedItems
            .filter((q) => q.pathname === "/sales" && q.method === "POST")
            .map((q) => `pending-${q.id}`)
        );
        const cleanedSnapshotSales = snapshot.sales.filter((row: any) => {
          if (!row?._pending) return true;
          const pendingId = String(row.id || "");
          if (!pendingId.startsWith("pending-")) return true;
          return activePendingIds.has(pendingId);
        });
        const mergedSnapshotSales = applyQueuedMutationsToSales(cleanedSnapshotSales, queuedItems as any[]);
        setSales(mergedSnapshotSales);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || mergedSnapshotSales.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [filters, isEmbed, isOnline, page, queuedItems]);
  const refreshSalesAfterPaint = useCallback(() => {
    window.setTimeout(() => loadSales(), 0);
  }, [loadSales]);

  useEffect(() => { loadSales(); }, [loadSales]);

  useEffect(() => {
    if (isEmbed) return;
    void apiCall("/api/v1/lots", { params: { limit: 100 } }).then((result) => {
      if (result.success) setFilterLots((result.data as any[]) || []);
    });
  }, [isEmbed]);

  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    setShowCreate(true);
    openCreate();
    window.history.replaceState({}, "", getEmbedQuickformPath("/sales"));
  }, [prefillHandled, searchParams, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload from server after pending entries sync successfully
  useEffect(() => {
    if (isEmbed) return;
    if (lastSyncResult && lastSyncResult.synced > 0) loadSales();
  }, [isEmbed, lastSyncResult, loadSales]);

  const applyDatePreset = (preset: "today" | "last7" | "month" | "all" | "custom") => {
    setDateRangePreset(preset);
    if (preset === "custom") {
      setPage(1);
      return;
    }
    const today = new Date();
    if (preset === "all") {
      setFilters((f) => ({ ...f, date_from: "", date_to: "" }));
      setPage(1);
      return;
    }
    if (preset === "today") {
      const value = formatInputDate(today);
      setFilters((f) => ({ ...f, date_from: value, date_to: value }));
      setPage(1);
      return;
    }
    if (preset === "last7") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      setFilters((f) => ({ ...f, date_from: formatInputDate(from), date_to: formatInputDate(today) }));
      setPage(1);
      return;
    }
    const range = getCurrentMonthDateRange();
    setFilters((f) => ({ ...f, date_from: range.from, date_to: range.to }));
    setPage(1);
  };

  useEffect(() => {
    if (!openActionId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-action-menu-root='true']")) return;
      setOpenActionId(null);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [openActionId]);

  const loadDropdowns = async () => {
    if (!isOnline) {
      const cached = readSalesFormCache();
      if (!cached) {
        setFormError("Offline sales setup not ready on this device yet. Connect internet once, open New Sale, then you can use it offline.");
        return false;
      }
      setGodowns(cached.godowns);
      setProducts(cached.products);
      setLots(cached.lots);
      setCurrencies(cached.currencies);
      if (cached.currencies.length > 0) {
        setForm((f) => ({ ...f, currencyId: f.currencyId || cached.currencies[0].id }));
      }
      return true;
    }

    const [custRes, gdRes, prodRes, lotRes, cityRes] = await Promise.all([
      Promise.resolve({ success: true, data: [] }), // customers loaded on-demand via CustomerSearch
      apiCall("/api/v1/godowns", { params: { limit: DEFAULT_LIST_PAGE_SIZE, is_active: "true", show_all: "true" } }),
      apiCall("/api/v1/products", { params: { limit: 100, is_active: "true" } }),
      apiCall("/api/v1/lots", { params: { limit: 100, status: "ongoing" } }),
      apiCall("/api/v1/cities"),
    ]);
    if (custRes.success) setCustomers(custRes.data as any[]);
    const nextGodowns = gdRes.success ? (gdRes.data as any[]) : [];
    const nextProducts = prodRes.success ? (prodRes.data as any[]) : [];
    const nextLots = lotRes.success ? (lotRes.data as any[]) : [];
    if (gdRes.success) setGodowns(nextGodowns);
    if (prodRes.success) setProducts(nextProducts);
    if (lotRes.success) setLots(nextLots);
    let nextCurrencies: any[] = [];
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) {
        setForm((f) => ({ ...f, currencyId: city.currencies[0].id }));
        nextCurrencies = city.currencies;
        setCurrencies(nextCurrencies);
      }
    }
    if (nextGodowns.length > 0 && nextProducts.length > 0 && nextCurrencies.length > 0) {
      writeSalesFormCache({
        godowns: nextGodowns,
        products: nextProducts,
        lots: nextLots,
        currencies: nextCurrencies,
      });
      return true;
    }
    const cached = readSalesFormCache();
    if (cached) {
      setGodowns(cached.godowns);
      setProducts(cached.products);
      setLots(cached.lots);
      setCurrencies(cached.currencies);
      if (cached.currencies.length > 0) {
        setForm((f) => ({ ...f, currencyId: f.currencyId || cached.currencies[0].id }));
      }
      return true;
    }
    return false;
  };

  // Load godown stock — serves from local cache when offline
  const loadGodownStock = async (godownId: number) => {
    if (!godownId) { setGodownStock([]); return; }
    setStockLoading(true);
    if (!isOnline) {
      const cached = await getCachedGodownStock(godownId);
      setGodownStock(cached ?? []);
      setStockLoading(false);
      return;
    }
    const result = await apiCall("/api/v1/inventory/godown-stock", { params: { godown_id: godownId } });
    if (result.success) {
      setGodownStock(result.data as any[]);
      await cacheGodownStock(godownId, result.data as any[]); // save for offline use
    } else setGodownStock([]);
    setStockLoading(false);
  };

  const resetSaleCreateForm = useCallback(() => {
    setForm({
      customerId: 0,
      godownId: 0,
      lotId: 0,
      saleDate: new Date().toISOString().split("T")[0],
      currencyId: currencies[0]?.id || 0,
      notes: "",
      items: [emptySaleItem()],
    });
    setGodownStock([]);
    setShortConfirmed(false);
    setSelectedCustomerName("");
  }, [currencies]);

  const openCreate = async (preset?: Partial<typeof form>) => {
    const loaded = await loadDropdowns();
    if (!loaded) return;
    const nextItems = preset?.items?.length ? preset.items : [emptySaleItem()];
    setForm((prev) => ({
      customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0],
      currencyId: prev.currencyId || 0, notes: "",
      ...preset,
      items: nextItems,
    }));
    setGodownStock([]);
    setSaleSavedNotice(null);
    setLatestCreatedSale(buildLatestSaleSummaryFromRow(sales[0], products, godowns, lots, currencies));
    setSelectedCustomerName("");
    setShowCreate(true); setFormError("");
  };

  const onGodownChange = (godownId: number) => {
    setForm((f) => ({ ...f, godownId }));
    loadGodownStock(godownId);
  };


  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptySaleItem()] }));
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: string, value: number) => setForm((f) => ({
    ...f,
    items: f.items.map((item, i) => (i === idx ? { ...item, [field]: value, ...(field === "productId" ? { lotId: 0 } : {}) } : item)),
  }));
  const ownCorrectItemQty = (item: any, lotId: number) => {
    if (!selectedSale || !item?.id) return 0;
    const oldItem = selectedSale.items?.find((row: any) => Number(row.id) === Number(item.id));
    if (!oldItem || Number(oldItem.productId || oldItem.product?.id) !== Number(item.productId)) return 0;
    if (Number(oldItem.lotId || oldItem.lot?.id) !== Number(lotId)) return 0;
    return Number(oldItem.qty || 0);
  };
  const lotOptionsForItem = (item: any, includeOwnCorrectQty = false) => {
    const currentLot = item?.lot;
    const breakdown = getLotBreakdown(item?.productId);
    const optionIds = new Set(
      breakdown
        .filter((lot: any) => Number(lot.available || 0) + (includeOwnCorrectQty ? ownCorrectItemQty(item, Number(lot.lotId)) : 0) > 0)
        .map((lot: any) => Number(lot.lotId))
    );
    const options = lots.filter((lot: any) => optionIds.has(Number(lot.id)));
    return currentLot && !options.some((lot: any) => Number(lot.id) === Number(currentLot.id))
      ? [...options, currentLot]
      : options;
  };
  const isSaleItemLotLocked = (item: any) => item?.lot?.status === "completed";

  const getAvailable = (productId: number) => {
    const s = godownStock.find((s) => s.productId === productId);
    return s?.available || 0;
  };
  const getLotBreakdown = (productId: number) => {
    const row = godownStock.find((s) => Number(s.productId) === Number(productId));
    return Array.isArray(row?.lotBreakdown) ? row.lotBreakdown : [];
  };
  const getLotAvailable = (productId: number, lotId: number, item?: any) => {
    const lot = getLotBreakdown(productId).find((row: any) => Number(row.lotId) === Number(lotId));
    return Number(lot?.available || 0) + (item ? ownCorrectItemQty(item, lotId) : 0);
  };

  const selectedCurrency = currencies.find((c) => c.id === form.currencyId);
  const amountPrefix = selectedCurrency?.symbol ? `${selectedCurrency.symbol} ` : "";
  const selectedCurrencyCode = String(selectedCurrency?.code || "").toUpperCase();
  const isAfghanistanSale = selectedCurrencyCode === "AFN";
  const productForItem = (item: any) => products.find((p: any) => p.id === Number(item.productId));
  const isPcsItem = (item: any) => productForItem(item)?.unitOfMeasure === "PCS";
  const itemPieces = (item: any) => {
    const product = productForItem(item);
    return product?.unitOfMeasure === "PCS" ? Number(item.qty || 0) * Number(product.piecesPerCarton || 0) : Number(item.qty || 0);
  };
  const itemLocalAmount = (item: any) => isPcsItem(item)
    ? itemPieces(item) * Number(item.ratePerPieceLocal || 0)
    : Number(item.qty || 0) * Number(item.ratePerCarton || 0);
  const itemUsdAmount = (item: any) => isPcsItem(item) ? itemPieces(item) * Number(item.ratePerPieceUsd || 0) : 0;
  const totalAmount = form.items.reduce((sum, i) => sum + itemLocalAmount(i), 0);
  const expandAutoLotItems = (items: any[], includeOwnCorrectQty = false) => {
    const expanded: any[] = [];
    for (const item of items) {
      if (Number(item.lotId || 0) > 0) {
        expanded.push(item);
        continue;
      }
      let remaining = Number(item.qty || 0);
      for (const lot of getLotBreakdown(item.productId)) {
        if (remaining <= 0) break;
        const qty = Math.min(remaining, Number(lot.available || 0) + (includeOwnCorrectQty ? ownCorrectItemQty(item, Number(lot.lotId)) : 0));
        if (qty <= 0) continue;
        expanded.push({ ...item, lotId: Number(lot.lotId), qty });
        remaining = Math.round((remaining - qty) * 100) / 100;
      }
      if (remaining > 0) return null;
    }
    return expanded;
  };
  const autoLotAllocationPreview = (item: any, includeOwnCorrectQty = false) => {
    if (!item.productId || Number(item.lotId || 0) > 0 || Number(item.qty || 0) <= 0) return "";
    let remaining = Number(item.qty || 0);
    const parts: string[] = [];
    for (const lot of getLotBreakdown(item.productId)) {
      if (remaining <= 0) break;
      const qty = Math.min(remaining, Number(lot.available || 0) + (includeOwnCorrectQty ? ownCorrectItemQty(item, Number(lot.lotId)) : 0));
      if (qty <= 0) continue;
      parts.push(`${lot.lotNumber} ${qty.toLocaleString("en-US")}`);
      remaining = Math.round((remaining - qty) * 100) / 100;
    }
    if (!parts.length) return "Auto: no stock in ongoing lots";
    return remaining > 0
      ? `Auto: ${parts.join(" + ")}; short ${remaining.toLocaleString("en-US")}`
      : `Auto: ${parts.join(" + ")}`;
  };

  const handleSubmit = async () => {
    setFormError("");
    if (!form.customerId) { setFormError("Please select a customer"); return; }
    if (!form.godownId) { setFormError("Please select a godown"); return; }
    const validItems = form.items.filter((i) => i.productId && i.qty > 0 && (isPcsItem(i) ? Number(i.ratePerPieceLocal || 0) > 0 : Number(i.ratePerCarton || 0) > 0));
    if (!validItems.length) { setFormError("Add at least one product with quantity"); return; }
    const expandedItems = expandAutoLotItems(validItems);
    if (!expandedItems) { setFormError("Auto lot allocation exceeds available stock. Split the remaining quantity manually or add stock."); return; }

    const shortItems = expandedItems.filter((item) => Number(item.lotId || 0) <= 0 || item.qty > getLotAvailable(item.productId, item.lotId));
    if (shortItems.length > 0) {
      const names = shortItems.map((item) => {
        const avail = getLotAvailable(item.productId, item.lotId);
        const pName = products.find((p: any) => p.id === item.productId)?.name || "Item";
        return avail <= 0 ? `${pName} (no stock)` : `${pName} (${avail} available)`;
      });
      setFormError(`Stock shortage: ${names.join(", ")}`);
      return;
    }
    setShortConfirmed(false);

    const payload = {
      customerId: form.customerId,
      godownId: form.godownId,
      lotId: expandedItems[0]?.lotId || form.lotId || null,
      saleDate: form.saleDate,
      currencyId: form.currencyId,
      notes: form.notes,
      items: expandedItems.map((item: any) => isPcsItem(item)
        ? {
          productId: item.productId,
          lotId: Number(item.lotId),
          cartonQty: Number(item.qty),
          ratePerPieceLocal: Number(item.ratePerPieceLocal),
          ...(Number(item.ratePerPieceUsd || 0) > 0 ? { ratePerPieceUsd: Number(item.ratePerPieceUsd) } : {}),
        }
        : { productId: item.productId, lotId: Number(item.lotId), qty: Number(item.qty), ratePerCarton: Number(item.ratePerCarton) }),
    };
    const formSnapshot = { ...form, lotId: expandedItems[0]?.lotId || form.lotId || 0, items: expandedItems, totalAmount };
    const payloadSignature = JSON.stringify(payload);
    if (!createRequestRef.current || createRequestRef.current.signature !== payloadSignature) {
      createRequestRef.current = { signature: payloadSignature, requestId: `browser-${crypto.randomUUID()}` };
    }
    const createRequestHeaders = { "x-sync-request-id": createRequestRef.current.requestId };

    if (resolvingQueueId) {
      const ok = await updateQueuedItem(resolvingQueueId, { body: JSON.stringify(payload) });
      if (!ok) {
        setFormError("Queued sale entry not found. Please retry from Activity.");
        return;
      }
      if (isOnline) {
        await retryQueuedItem(resolvingQueueId);
        await syncQueue();
      }
      setResolvingQueueId(null);
      setShowCreate(false);
      setShortConfirmed(false);
      loadSales();
      return;
    }

    // ── Offline: queue the sale and update stock locally ──
    if (!isOnline) {
      const selectedCustomer = customers.find((c: any) => c.id === form.customerId);
      const queueId = await enqueue({
        url: "/api/v1/sales",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: "/sales",
        auditMeta: {
          action: "create",
          entityType: "sale",
          entityLabel: "Sale (Pending)",
          entityDetail: `${selectedCustomer?.name || "Customer"} — ${totalAmount.toLocaleString("en-US")}`,
        },
      });

      // Deduct sold qty from local stock so the next sale uses the correct number
      const updatedStock = godownStock.map((s) => {
        const soldQty = expandedItems
          .filter((i) => i.productId === s.productId)
          .reduce((sum, i) => sum + Number(i.qty || 0), 0);
        return soldQty ? { ...s, available: Math.max(0, s.available - soldQty) } : s;
      });
      setGodownStock(updatedStock);
      await cacheGodownStock(form.godownId, updatedStock);
      setLatestCreatedSale(buildLatestSaleSummary(null, formSnapshot, selectedCustomerName, products, godowns, lots, currencies, true));

      // Add an optimistic row to the sales list
      const currency = currencies.find((c) => c.id === form.currencyId);
      setSales((prev) => {
        const next = [{
        id: `pending-${queueId}`,
        voucherNo: "—",
        saleDate: form.saleDate,
        customer: { name: "..." },
        totalAmount: totalAmount,
        status: "pending_sync",
        currency: { code: currency?.code ?? "" },
        _pending: true,
      }, ...prev];
        persistSalesSnapshot(next, total + 1);
        return next;
      });

      resetSaleCreateForm();
      setResolvingQueueId(null);
      setSaleSavedNotice("Sale queued for sync.");
      setTimeout(() => setSaleSavedNotice(null), 5000);
      return;
    }

    // ── Online: normal submit ──
    setSubmitting(true);
    const result = await apiCall("/api/v1/sales", { method: "POST", body: payload, headers: createRequestHeaders });
    setSubmitting(false);
    if (result.success) {
      createRequestRef.current = null;
      setResolvingQueueId(null);
      setLatestCreatedSale(buildLatestSaleSummary(result.data, formSnapshot, selectedCustomerName, products, godowns, lots, currencies));
      resetSaleCreateForm();
      setSaleSavedNotice("Sale recorded. Record payment if the customer paid on the spot.");
      setTimeout(() => setSaleSavedNotice(null), 5000);
      refreshSalesAfterPaint();
    } else { setFormError(result.error || "Failed to create sale"); }
  };

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId || !isEmbed && user?.role !== "city_admin") return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/sales");
    if (!target) return;
    try {
      const parsed = safeParseQueuedBody(target.body);
      if (!parsed) return;
      openCreate({
        customerId: Number(parsed.customerId || 0),
        godownId: Number(parsed.godownId || 0),
        lotId: Number(parsed.lotId || 0),
        saleDate: String(parsed.saleDate || new Date().toISOString().split("T")[0]),
        currencyId: Number(parsed.currencyId || 0),
        notes: String(parsed.notes || ""),
        items: Array.isArray(parsed.items) ? (parsed.items as any[]) : [emptySaleItem()],
      });
      setResolvingQueueId(queueId);
      setFormError("Resolving queued sale. Save to update and re-sync.");
      window.history.replaceState({}, "", getEmbedQuickformPath("/sales"));
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hard delete sale (super admin + 2FA)
  const openHardDelete = (sale: any) => { setHardDeleteTarget(sale); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError("Password is required"); return; }
    if (String(hardDeleteTarget?.id || "").startsWith("pending-")) {
      setHardDeleteError("Pending sale is not synced yet. Use Cancel to remove it locally.");
      return;
    }
    setHardDeleteSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setHardDeleteSubmitting(false);
    if (result.success) { setShowHardDelete(false); loadSales(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  // Cancel sale
  const openCancel = (sale: any) => { setSelectedSale(sale); setCancelReason(""); setShowCancel(true); setFormError(""); };
  const handleCancel = async () => {
    if (!cancelReason.trim()) { setFormError("Cancellation reason is required"); return; }
    if (!isOnline) {
      const pendingId = String(selectedSale?.id || "");
      if (pendingId.startsWith("pending-")) {
        const queueId = pendingId.replace("pending-", "");
        await discardQueuedItem(queueId);
        setSales((prev) => {
          const next = prev.filter((sale: any) => String(sale.id) !== pendingId);
          persistSalesSnapshot(next);
          return next;
        });
        setShowCancel(false);
        return;
      }
      await enqueue({
        url: `/api/v1/sales/${selectedSale.id}/cancel`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
        pathname: "/sales",
        auditMeta: {
          action: "cancel",
          entityType: "sale",
          entityLabel: "Sale cancel (Pending)",
          entityDetail: `${selectedSale?.voucherNo || "Sale"} — ${cancelReason}`,
        },
      });
      setSales((prev) => {
        const next = prev.map((sale: any) =>
          sale.id === selectedSale.id
            ? { ...sale, status: "cancelled", cancellationReason: cancelReason, _pending: true }
            : sale
        );
        persistSalesSnapshot(next);
        return next;
      });
      setShowCancel(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${selectedSale.id}/cancel`, { method: "PUT", body: { reason: cancelReason } });
    setSubmitting(false);
    if (result.success) { setShowCancel(false); loadSales(); } else { setFormError(result.error || "Failed"); }
  };

  // Discount
  const openDiscount = (sale: any) => { setSelectedSale(sale); setDiscountForm({ discountAmount: 0, notes: "", discountDate: new Date().toISOString().split("T")[0] }); setShowDiscount(true); setFormError(""); };

  const openCorrect = async (sale: any) => {
    // Load products if not already loaded (fixes empty dropdown on first use)
    if (!products.length) await loadDropdowns();
    if (sale.godownId || sale.godown?.id) await loadGodownStock(Number(sale.godownId || sale.godown.id));
    setSelectedSale(sale);
    setCorrectItems(sale.items?.map((i: any) => ({
      id: i.id,
      productId: i.productId || i.product?.id,
      lotId: i.lotId || i.lot?.id || sale.lot?.id || 0,
      lot: i.lot || sale.lot || null,
      qty: i.qty,
      ratePerCarton: i.ratePerCarton || i.rate,
    })) || []);
    setCorrectReason(""); setShowCorrect(true); setFormError("");
  };
  const handleCorrect = async () => {
    if (!correctReason.trim()) { setFormError("Provide reason for correction"); return; }
    const validItems = correctItems.filter(i => i.productId && i.qty > 0 && i.ratePerCarton > 0);
    if (!validItems.length) { setFormError("Add at least one item"); return; }
    const expandedItems = expandAutoLotItems(validItems, true);
    if (!expandedItems) { setFormError("Auto lot allocation exceeds available stock. Split the remaining quantity manually or add stock."); return; }
    const shortItems = expandedItems.filter((item) => Number(item.lotId || 0) <= 0 || item.qty > getLotAvailable(item.productId, item.lotId, item));
    if (shortItems.length > 0) {
      const names = shortItems.map((item) => {
        const avail = getLotAvailable(item.productId, item.lotId, item);
        const pName = products.find((p: any) => p.id === item.productId)?.name || "Item";
        return avail <= 0 ? `${pName} (no stock)` : `${pName} (${avail} available)`;
      });
      setFormError(`Stock shortage: ${names.join(", ")}`);
      return;
    }
    if (!isOnline) {
      const pendingId = String(selectedSale?.id || "");
      if (pendingId.startsWith("pending-")) {
        const queueId = pendingId.replace("pending-", "");
        const existing = queuedItems.find((q) => q.id === queueId);
        let parsed: any = {};
        try {
          parsed = existing?.body ? JSON.parse(existing.body) : {};
        } catch {
          parsed = {};
        }
        const ok = await updateQueuedItem(queueId, {
          body: JSON.stringify({ ...parsed, items: expandedItems }),
        });
        if (!ok) {
          setFormError("Pending queued sale not found. Retry from Activity.");
          return;
        }
        const correctedTotal = expandedItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.ratePerCarton || 0), 0);
        setSales((prev) => {
          const next = prev.map((sale: any) =>
            String(sale.id) === pendingId
              ? { ...sale, totalAmount: correctedTotal, _pending: true }
              : sale
          );
          persistSalesSnapshot(next);
          return next;
        });
        setShowCorrect(false);
        return;
      }
      await enqueue({
        url: `/api/v1/sales/${selectedSale.id}/correct`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: expandedItems, reason: correctReason }),
        pathname: "/sales",
        auditMeta: {
          action: "correct",
          entityType: "sale",
          entityLabel: "Sale correction (Pending)",
          entityDetail: `${selectedSale?.voucherNo || "Sale"} — ${correctReason}`,
        },
      });
      const correctedTotal = expandedItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.ratePerCarton || 0), 0);
      setSales((prev) => {
        const next = prev.map((sale: any) =>
          sale.id === selectedSale.id
            ? { ...sale, totalAmount: correctedTotal, _pending: true }
            : sale
        );
        persistSalesSnapshot(next);
        return next;
      });
      setShowCorrect(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/sales/${selectedSale.id}/correct`, { method: "PUT", body: { items: expandedItems, reason: correctReason } });
    setSubmitting(false);
    if (r.success) { setShowCorrect(false); loadSales(); } else { setFormError(r.error || "Failed"); }
  };
  const handleDiscount = async () => {
    if (!discountForm.discountAmount || discountForm.discountAmount <= 0) { setFormError("Discount amount must be positive"); return; }
    if (!isOnline) {
      const pendingId = String(selectedSale?.id || "");
      if (pendingId.startsWith("pending-")) {
        setFormError("For pending offline sales, use Correct Sale to adjust item rates/amount.");
        return;
      }
      await enqueue({
        url: `/api/v1/sales/${selectedSale.id}/discount`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discountForm),
        pathname: "/sales",
        auditMeta: {
          action: "discount",
          entityType: "sale",
          entityLabel: "Sale discount (Pending)",
          entityDetail: `${selectedSale?.voucherNo || "Sale"} — ${Number(discountForm.discountAmount || 0).toLocaleString("en-US")}`,
        },
      });
      setSales((prev) => {
        const next = prev.map((sale: any) =>
          sale.id === selectedSale.id
            ? { ...sale, totalAmount: Math.max(0, Number(sale.totalAmount || 0) - Number(discountForm.discountAmount || 0)), _pending: true }
            : sale
        );
        persistSalesSnapshot(next);
        return next;
      });
      setShowDiscount(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${selectedSale.id}/discount`, { method: "POST", body: discountForm });
    setSubmitting(false);
    if (result.success) { setShowDiscount(false); loadSales(); } else { setFormError(result.error || "Failed"); }
  };

  const salesVoucherColumn = {
    key: "voucherNo",
    label: simplifyModals ? "Ref. No." : t("voucher_hash"),
    className: simplifyModals ? "pl-2 pr-0.5 w-[3.25rem]" : "px-2 w-16",
    headerClassName: simplifyModals ? "pl-2 pr-0.5 normal-case tracking-normal" : undefined,
    render: (s: any) => <span className="font-mono text-xs font-medium">{s.voucherNo}</span>,
  };
  const salesDateColumn = {
    key: "saleDate",
    label: t("date"),
    className: simplifyModals ? "pl-0.5 pr-2 w-[4.5rem] whitespace-nowrap" : "px-2 w-[4.75rem] whitespace-nowrap",
    headerClassName: simplifyModals ? "pl-0.5 pr-2 normal-case tracking-normal" : undefined,
    render: (s: any) => <span className="tabular-nums">{formatDate(s.saleDate)}</span>,
  };
  const salesCustomerColumn = {
    key: "customer",
    label: t("customer"),
    className: "px-2",
    render: (s: any) => (
      <div className="min-w-0 leading-tight">
        <span className="block truncate">{s.customer?.name}</span>
        {user?.role === "super_admin" && s.cityName && (
          <span className="block truncate text-[11px] text-indigo-500">{s.cityName}</span>
        )}
      </div>
    ),
  };
  const salesProductColumn = {
    key: "items",
    label: t("product"),
    width: simplifyModals ? "7rem" : "8rem",
    className: simplifyModals ? "pl-2 pr-0.5 max-w-[7rem]" : "px-2 pr-1 max-w-[8rem]",
    headerClassName: simplifyModals ? "pr-0.5 normal-case tracking-normal" : undefined,
    render: (s: any) => (
      <div className="min-w-0 leading-tight">
        {s.items?.map((i: any, idx: number) => (
          <div key={idx} className="truncate" title={i.productName}>{i.productName}</div>
        ))}
      </div>
    ),
  };
  const salesQtyColumn = {
    key: "cartons",
    label: simplifyModals ? t("qty") : "Crtn",
    width: "3rem",
    headerClassName: "normal-case tracking-normal text-center overflow-visible align-middle",
    className: "px-1.5 text-center tabular-nums whitespace-nowrap",
    render: (s: any) => (
      <div className="leading-tight">
        {s.items?.map((i: any, idx: number) => (
          <div key={idx} className="tabular-nums">{Number(i.qty)}</div>
        ))}
      </div>
    ),
  };
  const salesTailColumns = [
    {
      key: "ratePerCarton",
      label: "Rate",
      width: simplifyModals ? "5.5rem" : "6rem",
      className: simplifyModals ? "pl-0.5 pr-2 tabular-nums whitespace-nowrap" : "px-2 pl-3 tabular-nums whitespace-nowrap",
      headerClassName: simplifyModals ? "pl-0.5 pr-2 normal-case tracking-normal" : undefined,
      render: (s: any) => (
        <div className="leading-tight">
          {s.items?.map((i: any, idx: number) => (
            <div key={idx}>
              {s.currency?.symbol}{Number(i.ratePerCarton || 0).toLocaleString("en-US")}
            </div>
          ))}
        </div>
      ),
    },
    { key: "totalAmount", label: t("amount"), className: "px-2 whitespace-nowrap tabular-nums", render: (s: any) => <span className="font-medium">{s.currency?.symbol}{formatCurrency(s.totalAmount, "").trim()}</span> },
    {
      key: "godown",
      label: t("godown"),
      className: "px-2 max-w-[7rem]",
      render: (s: any) => (
        <span className="block leading-tight">
          <span className="block truncate">{s.godown?.name}</span>
          {s.godown?.crossCity && <span className="block truncate text-[11px] text-orange-500">⟵ {s.godown.sourceCityName}</span>}
        </span>
      ),
    },
    { key: "lot", label: t("lot"), className: "px-2 w-14", render: (s: any) => <span className="truncate">{s.lot?.lotNumber}</span> },
    {
      key: "status",
      label: t("status"),
      className: "px-2 w-24",
      render: (s: any) => (
        <div className="leading-tight">
          <StatusBadge status={s.status} />
          {s.status === "cancelled" && s.cancellationReason && (
            <p className="mt-0.5 max-w-[9rem] truncate text-[11px] text-gray-500" title={s.cancellationReason}>
              {s.cancellationReason}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (s: any) => (
        <RowActionMenu
          open={openActionId === s.id}
          onOpenChange={(open) => setOpenActionId(open ? s.id : null)}
        >
          {s.status === "active" && (
            <>
              <button onClick={() => { setOpenActionId(null); openCorrect(s); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("correct_sale")}</button>
              <button onClick={() => { setOpenActionId(null); openDiscount(s); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-yellow-700 hover:bg-yellow-50 sm:py-2 sm:text-xs">{t("discount")}</button>
              <button onClick={() => { setOpenActionId(null); openCancel(s); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("cancel")}</button>
            </>
          )}
          {user?.role === "super_admin" && !String(s.id || "").startsWith("pending-") && (
            <button onClick={() => { setOpenActionId(null); openHardDelete(s); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-800 hover:bg-red-50 sm:py-2 sm:text-xs">{t("hard_delete")}</button>
          )}
        </RowActionMenu>
      ),
    },
  ];
  const salesColumns = simplifyModals
    ? [salesVoucherColumn, salesDateColumn, salesCustomerColumn, salesQtyColumn, salesProductColumn, ...salesTailColumns]
    : [salesVoucherColumn, salesDateColumn, salesCustomerColumn, salesProductColumn, salesQtyColumn, ...salesTailColumns];

  return (
    <div className={isEmbed ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {!isEmbed && <PageHeader title={t("sales")} />}
      {!isEmbed && (
      <>
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached sales data for this device.
        </div>
      )}

      {!isEmbed && !showCreate && saleSavedNotice && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex flex-wrap items-center justify-between gap-3">
          <span>{saleSavedNotice}</span>
          <Link href="/payments" className="text-sm font-semibold text-green-700 hover:underline">
            Go to Payments
          </Link>
        </div>
      )}

      <div className="mb-3 flex min-w-0 flex-col items-start gap-2 md:flex-row md:flex-nowrap md:items-center md:overflow-x-auto">
        <div className="flex min-w-0 w-full flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] md:w-auto">
          <input
            type="text"
            value={filters.query}
            onChange={(e) => { setFilters((f) => ({ ...f, query: e.target.value })); setPage(1); }}
            placeholder="Search…"
            className="input-field h-9 min-h-9 min-w-[7rem] flex-[1_1_7rem] max-w-[min(100%,14rem)] py-1.5 text-sm md:max-w-[20rem]"
          />
          <select value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }} className="select-field !w-auto h-9 min-h-9 min-w-[8.5rem] shrink-0 py-1.5 pl-2.5 pr-8 text-sm md:max-w-[8.75rem]">
            <option value="">{t("all_statuses")}</option><option value="active">{t("active")}</option><option value="cancelled">{t("cancelled")}</option><option value="marked_short">{t("marked_short")}</option>
          </select>
          <select
            value={filters.lot_id}
            onChange={(e) => { setFilters((f) => ({ ...f, lot_id: e.target.value })); setPage(1); }}
            className="select-field !w-auto h-9 min-h-9 min-w-[7.5rem] shrink-0 py-1.5 pl-2.5 pr-8 text-sm md:max-w-[9rem]"
            aria-label={`${t("lot")} filter`}
          >
            <option value="">All lots</option>
            {filterLots.map((lot: any) => (
              <option key={lot.id} value={String(lot.id)}>
                {lot.lotNumber}{lot.status === "completed" ? " ✓" : ""}
              </option>
            ))}
          </select>
          <select
            value={dateRangePreset}
            onChange={(e) => applyDatePreset(e.target.value as "today" | "last7" | "month" | "all" | "custom")}
            className="select-field !w-auto h-9 min-h-9 min-w-[7.75rem] shrink-0 py-1.5 pl-2.5 pr-8 text-sm md:max-w-[7.5rem]"
            aria-label="Date range preset"
          >
            <option value="month">This month</option>
            <option value="today">Today</option>
            <option value="last7">7 days</option>
            <option value="all">All dates</option>
            <option value="custom">Custom</option>
          </select>
          {dateRangePreset === "custom" && (
            <>
              <input type="date" value={filters.date_from} onChange={(e) => { setFilters((f) => ({ ...f, date_from: e.target.value })); setPage(1); }} className="input-field h-9 min-h-9 min-w-[8.75rem] shrink-0 py-1.5 text-sm" aria-label="From date" />
              <input type="date" value={filters.date_to} onChange={(e) => { setFilters((f) => ({ ...f, date_to: e.target.value })); setPage(1); }} className="input-field h-9 min-h-9 min-w-[8.75rem] shrink-0 py-1.5 text-sm" aria-label="To date" />
            </>
          )}
        </div>
        <LedgerExportButtons
          type="sales"
          dateFrom={filters.date_from || undefined}
          dateTo={filters.date_to || undefined}
          cityId={user?.cityId ?? undefined}
          query={filters.query}
          status={filters.status || undefined}
          disabled={!isOnline}
          className="shrink-0 justify-end self-end w-full md:w-auto md:ml-auto"
        />
      </div>

      <DataTable searchable={false} compact columns={salesColumns} data={sales} loading={loading} emptyMessage={t("no_data")} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      </>
      )}
      {/* ========== CREATE SALE MODAL ========== */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setShortConfirmed(false); setFormError(""); setSaleSavedNotice(null); setLatestCreatedSale(null); if (isEmbed) closeEmbed(); }} title={t("new_sale")} size={isEmbed ? "lg" : "xl"} inline={isEmbed} hideHeader={isEmbed}>
        {saleSavedNotice && (
          <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{saleSavedNotice}</div>
        )}
        {latestCreatedSale && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-semibold">{latestCreatedSale.pending ? "Queued" : "Latest"} Sale</span>
              <span className="shrink-0 tabular-nums text-emerald-700">{latestCreatedSale.date ? formatDate(latestCreatedSale.date) : "—"}</span>
              <span className="min-w-0 truncate text-emerald-900">{latestCreatedSale.customer}</span>
              <span className="ml-auto shrink-0 font-semibold tabular-nums">{latestCreatedSale.amount}</span>
            </div>
            {latestCreatedSale.meta.length > 0 && (
              <div className="mt-1 truncate text-[11px] text-emerald-700">{latestCreatedSale.meta.join(" · ")}</div>
            )}
          </div>
        )}
        {formError && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${shortConfirmed ? "bg-amber-50 border-amber-300 text-amber-800" : "bg-red-50 border-red-200 text-red-700"}`}>
            {formError}
          </div>
        )}

        {simplifyModals ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("date")} *</label>
              <MobileDateInput
                variant="field"
                value={form.saleDate}
                onChange={(saleDate) => setForm((f) => ({ ...f, saleDate }))}
                placeholder={t("date")}
                aria-label={t("date")}
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("godown")} *</label>
              <select value={form.godownId} onChange={(e) => onGodownChange(parseInt(e.target.value))} className="select-field">
                <option value={0}>{t("select_godown")}</option>
                {Array.from(new Set(godowns.map((g: any) => g.cityName))).map((cityName) => (
                  <optgroup key={cityName as string} label={cityName as string}>
                    {godowns.filter((g: any) => g.cityName === cityName).map((g: any) => (
                      <option key={g.id} value={g.id}>
                        {g.cityId !== user?.cityId ? `⟵ ${g.name}` : g.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <CustomerFieldWithNew
            value={form.customerId}
            onChange={(id, name) => { setSelectedCustomerName(name); setForm((f) => ({ ...f, customerId: id })); }}
            placeholder={t("search_customer")}
            label={t("customer")}
            cityId={
              form.godownId > 0
                ? godowns.find((g: any) => g.id === form.godownId)?.cityId
                : user?.cityId
            }
          />

          {currencies.length > 1 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("currency")}</label>
              <select value={form.currencyId} onChange={(e) => setForm((f) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{formatCurrencySelectLabel(c)}</option>)}
              </select>
            </div>
          )}

          <div className={isEmbed ? "quickform-panel space-y-2" : "rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-2"}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("product")} *</p>
              <button type="button" onClick={addItem} className="text-xs font-semibold text-primary-700 hover:text-primary-800">+ {t("add_item")}</button>
            </div>
            <div className="module-scroll-x overflow-x-auto -mx-1 px-1 py-1">
              <div className="min-w-[590px] space-y-2">
                <div className="grid grid-cols-[minmax(0,1fr)_78px_68px_52px_80px_84px_24px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  <span>{t("product")}</span>
                  <span>{t("lot")}</span>
                  <span className="text-right">{t("qty")}</span>
                  <span className="text-center">{t("available")}</span>
                  <span className="text-right truncate" title={t("rate_per_carton")}>Rate</span>
                  <span className="text-right">{t("amount")}</span>
                  <span />
                </div>
                {form.items.map((item, idx) => {
                  const avail = getAvailable(item.productId);
                  const pcsItem = isPcsItem(item);
                  const localPcsLabel = isAfghanistanSale ? "AFN/PCS" : "PKR/PCS";
                  return (
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_78px_68px_52px_80px_84px_24px] gap-2 items-center">
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(idx, "productId", parseInt(e.target.value))}
                        className="select-field min-w-0 text-sm"
                      >
                        <option value={0}>{t("select_product")}</option>
                        {products.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <select value={item.lotId || 0} onChange={(e) => updateItem(idx, "lotId", parseInt(e.target.value))} className="select-field min-w-0 text-xs">
                        <option value={0}>Auto</option>
                        {lotOptionsForItem(item).map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}{l.status === "completed" ? " ✓" : ""}</option>)}
                      </select>
                      <input
                        type="number"
                        value={item.qty || ""}
                        onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)}
                        className={`input-field text-sm text-right ${item.productId && item.qty > avail ? "border-red-400 bg-red-50" : ""}`}
                        placeholder="0"
                        max={avail || undefined}
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                      <span className={`text-center text-xs font-semibold tabular-nums ${item.productId ? (avail > 0 ? "text-green-700" : "text-red-500") : "text-gray-300"}`}>
                        {item.productId ? avail : "—"}
                      </span>
                      {pcsItem ? (
                        <div className="space-y-1">
                          <input type="number" value={item.ratePerPieceLocal || ""} onChange={(e) => updateItem(idx, "ratePerPieceLocal", parseFloat(e.target.value) || 0)} className="input-field text-sm text-right" placeholder={localPcsLabel} onWheel={(e) => e.currentTarget.blur()} />
                          {isAfghanistanSale && <input type="number" value={item.ratePerPieceUsd || ""} onChange={(e) => updateItem(idx, "ratePerPieceUsd", parseFloat(e.target.value) || 0)} className="input-field text-sm text-right" placeholder="USD/PCS" onWheel={(e) => e.currentTarget.blur()} />}
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={item.ratePerCarton || ""}
                          onChange={(e) => updateItem(idx, "ratePerCarton", parseFloat(e.target.value) || 0)}
                          className="input-field text-sm text-right"
                          placeholder="0"
                          onWheel={(e) => e.currentTarget.blur()}
                        />
                      )}
                      <p className="text-right text-sm font-medium tabular-nums text-gray-900">
                        {amountPrefix}{itemLocalAmount(item).toLocaleString("en-US")}
                        {pcsItem && isAfghanistanSale && Number(item.ratePerPieceUsd || 0) > 0 && <span className="block text-[10px] text-gray-500">${itemUsdAmount(item).toLocaleString("en-US")}</span>}
                      </p>
                      {form.items.length > 1 ? (
                        <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-lg leading-none" aria-label="Remove item">×</button>
                      ) : (
                        <span />
                      )}
                      {autoLotAllocationPreview(item) && <p className="col-span-7 text-[11px] text-blue-700">{autoLotAllocationPreview(item)}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-200/80 pt-2">
              <span className="text-xs uppercase tracking-wide text-gray-500">{t("total")}: </span>
              <span className="ml-2 text-base font-bold tabular-nums text-gray-900">{amountPrefix}{totalAmount.toLocaleString("en-US")}</span>
            </div>
          </div>

          <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("notes")}</label>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        ) : (
        <>
        {/* Date — always first */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
          <input type="date" value={form.saleDate} onChange={(e) => setForm((f) => ({ ...f, saleDate: e.target.value }))} className="input-field" autoFocus />
        </div>
        <div className={isEmbed ? "quickform-panel mb-3 space-y-3" : "mb-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4"}>
          {!isEmbed && (
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Step 1</p>
            <h3 className="text-sm font-semibold text-gray-900 mt-1">Choose customer and stock source</h3>
          </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <CustomerFieldWithNew
              value={form.customerId}
              onChange={(id, name) => { setSelectedCustomerName(name); setForm((f) => ({ ...f, customerId: id })); }}
              placeholder={t("search_customer")}
              cityId={
                form.godownId > 0
                  ? godowns.find((g: any) => g.id === form.godownId)?.cityId
                  : user?.cityId
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("godown")} *</label>
            <select value={form.godownId} onChange={(e) => onGodownChange(parseInt(e.target.value))} className="select-field">
              <option value={0}>{t("select_godown")}</option>
              {/* Group godowns by city */}
              {Array.from(new Set(godowns.map((g: any) => g.cityName))).map((cityName) => (
                <optgroup key={cityName as string} label={cityName as string}>
                  {godowns.filter((g: any) => g.cityName === cityName).map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.cityId !== user?.cityId ? `⟵ ${g.name}` : g.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* Cross-city warning */}
            {form.godownId > 0 && !simplifyModals && godowns.find((g: any) => g.id === form.godownId)?.cityId !== user?.cityId && (
              <p className="text-xs text-orange-600 mt-1">Cross-city godown — stock from {godowns.find((g: any) => g.id === form.godownId)?.cityName}</p>
            )}
          </div>
          </div>
        </div>

        {currencies.length > 1 && (
          <div className={isEmbed ? "mb-3" : "mb-4"}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
            <select value={form.currencyId} onChange={(e) => setForm((f) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
              {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>)}
            </select>
          </div>
        )}

        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
        </div>

        {/* GODOWN STOCK INFO */}
        {form.godownId > 0 && (
          <div className={isEmbed ? "quickform-info mb-3" : "mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"}>
            {!simplifyModals && (
            <h4 className={isEmbed ? "quickform-info-title" : "text-sm font-semibold text-blue-800 mb-2"}>
              {isEmbed ? t("available") : `📦 ${t("available")}`} — {godowns.find((g: any) => g.id === form.godownId)?.name || t("godown")}
              {godowns.find((g: any) => g.id === form.godownId)?.cityId !== user?.cityId && (
                <span className="ml-2 text-xs font-normal text-orange-600">({godowns.find((g: any) => g.id === form.godownId)?.cityName})</span>
              )}
            </h4>
            )}
            {stockLoading ? (
              <p className={isEmbed ? "text-sm text-[#8f7963]" : "text-sm text-blue-600"}>{t("loading_stock")}</p>
            ) : godownStock.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {godownStock.map((s) => (
                  <div key={s.productId} className={`text-sm px-2 py-1 rounded ${s.available > 0 ? "bg-white" : "bg-red-50 text-red-400"}`}>
                    <span className="font-medium">{s.productName}:</span>{" "}
                    <strong className={s.available > 0 ? "text-green-700" : "text-red-500"}>{s.available}</strong>
                    <span className="text-xs text-gray-400"> {t("cartons")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-yellow-700">⚠ {t("no_stock")}</p>
            )}
          </div>
        )}

        {/* LINE ITEMS */}
        <div className={isEmbed ? "quickform-panel mb-3 space-y-2" : "mb-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4"}>
          {!isEmbed && (
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Step 2</p>
            <h3 className="text-sm font-semibold text-gray-900 mt-1">Add products and selling rates</h3>
          </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">{t("product")} *</label>
            <button onClick={addItem} className="text-primary-600 text-sm font-medium hover:text-primary-700">+ {t("add_item")}</button>
          </div>
          <div className="space-y-2">
            {form.items.map((item, idx) => {
              const avail = getAvailable(item.productId);
              const pcsItem = isPcsItem(item);
              const localPcsLabel = isAfghanistanSale ? "AFN/PCS" : "PKR/PCS";
              return (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="flex-1">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("product")}</label>}
                    <select value={item.productId} onChange={(e) => updateItem(idx, "productId", parseInt(e.target.value))} className="select-field text-sm">
                      <option value={0}>{t("select_product")}</option>
                      {products.map((p: any) => {
                        const stock = getAvailable(p.id);
                        return <option key={p.id} value={p.id}>{p.name} {stock > 0 ? `(${stock})` : "(—)"}</option>;
                      })}
                    </select>
                  </div>
                  <div className="w-24">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("lot")}</label>}
                    <select value={item.lotId || 0} onChange={(e) => updateItem(idx, "lotId", parseInt(e.target.value))} className="select-field text-sm">
                      <option value={0}>Auto</option>
                      {lotOptionsForItem(item).map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}{l.status === "completed" ? " ✓" : ""}</option>)}
                    </select>
                    {autoLotAllocationPreview(item) && <p className="mt-1 text-[11px] text-blue-700">{autoLotAllocationPreview(item)}</p>}
                  </div>
                  <div className="w-24">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{pcsItem ? "Qty (CTN)" : t("qty")}</label>}
                    <input type="number" value={item.qty || ""} onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)} className={`input-field text-sm ${item.productId && item.qty > avail ? "border-red-400 bg-red-50" : ""}`} placeholder="0" max={avail || undefined} />
                  </div>
                  <div className="w-14 text-center">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("available")}</label>}
                    <span className={`text-xs font-medium ${item.productId ? (avail > 0 ? "text-green-600" : "text-red-500") : "text-gray-300"}`}>{item.productId ? avail : "-"}</span>
                  </div>
                  <div className="w-32">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{pcsItem ? localPcsLabel : t("rate_per_carton")}</label>}
                    {pcsItem ? (
                      <div className="space-y-1">
                        <input type="number" value={item.ratePerPieceLocal || ""} onChange={(e) => updateItem(idx, "ratePerPieceLocal", parseFloat(e.target.value) || 0)} className="input-field text-sm" placeholder={localPcsLabel} />
                        {isAfghanistanSale && <input type="number" value={item.ratePerPieceUsd || ""} onChange={(e) => updateItem(idx, "ratePerPieceUsd", parseFloat(e.target.value) || 0)} className="input-field text-sm" placeholder="USD/PCS" />}
                      </div>
                    ) : (
                      <input type="number" value={item.ratePerCarton || ""} onChange={(e) => updateItem(idx, "ratePerCarton", parseFloat(e.target.value) || 0)} className="input-field text-sm" placeholder="0" />
                    )}
                  </div>
                  <div className="w-28 text-right">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("amount")}</label>}
                    <p className="py-2 text-sm font-medium">{amountPrefix}{itemLocalAmount(item).toLocaleString("en-US")}{pcsItem && isAfghanistanSale && Number(item.ratePerPieceUsd || 0) > 0 && <span className="block text-xs text-gray-500">${itemUsdAmount(item).toLocaleString("en-US")}</span>}</p>
                  </div>
                  {form.items.length > 1 && <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 pb-2 text-lg">×</button>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-right">
            <span className="text-sm text-gray-500">{t("total")}: </span>
            <span className="text-lg font-bold text-gray-900">{amountPrefix}{totalAmount.toLocaleString("en-US")}</span>
          </div>
        </div>

        </>
        )}

        {!isEmbed && !simplifyModals && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Step 3</p>
          <h3 className="text-sm font-semibold text-blue-900 mt-1">Review before saving</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Items</div>
              <div className="text-sm font-semibold text-gray-900">{form.items.filter((i) => i.productId && i.qty > 0).length}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Cartons</div>
              <div className="text-sm font-semibold text-gray-900">{form.items.reduce((sum, i) => sum + (i.qty || 0), 0).toLocaleString("en-US")}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Godown</div>
              <div className="text-sm font-semibold text-gray-900 truncate">{godowns.find((g: any) => g.id === form.godownId)?.name || "Not selected"}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Sale Total</div>
              <div className="text-sm font-semibold text-gray-900">{totalAmount.toLocaleString("en-US")}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-blue-700">
            After saving, you can go straight to Payments if the customer paid on the spot.
          </p>
        </div>
        )}

        {isEmbed && !simplifyModals && (
          <p className="mb-3 text-sm font-semibold text-[#5d4a3a] text-right">
            Total: {amountPrefix}{totalAmount.toLocaleString("en-US")}
          </p>
        )}

        <div className={isEmbed ? "quickform-footer" : "flex justify-end gap-3 pt-4 border-t"}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={
              isEmbed
                ? `glass-btn w-full min-h-11 disabled:opacity-60 ${shortConfirmed ? "glass-btn-warning" : "glass-btn-primary"}`
                : `text-sm font-medium px-4 py-2 rounded-lg transition-colors ${shortConfirmed ? "bg-amber-500 hover:bg-amber-600 text-white" : "btn-primary"}`
            }
          >
            {submitting ? "Saving…" : shortConfirmed ? "Confirm short sale" : isEmbed ? "Save sale" : t("new_sale")}
          </button>
        </div>
      </Modal>

      {/* ========== CANCEL SALE MODAL ========== */}
      <Modal open={showCancel} onClose={() => setShowCancel(false)} title={`${t("cancel_sale")}: ${selectedSale?.voucherNo || ""}`} size="md">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("cancel_reason")} *</label>
          <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="input-field" rows={3} />
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCancel} disabled={submitting} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm">{submitting ? "..." : t("cancel_sale")}</button>
        </div>
      </Modal>

      {/* ========== DISCOUNT MODAL ========== */}
      <Modal open={showDiscount} onClose={() => setShowDiscount(false)} title={`${t("discount")}: ${selectedSale?.voucherNo || ""}`} size="md">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("discount_amount")} *</label>
            <input type="number" value={discountForm.discountAmount || ""} onChange={(e) => setDiscountForm((f) => ({ ...f, discountAmount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label>
            <input type="date" value={discountForm.discountDate} onChange={(e) => setDiscountForm((f) => ({ ...f, discountDate: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={discountForm.notes} onChange={(e) => setDiscountForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleDiscount} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("apply_discount")}</button>
        </div>
      </Modal>

      {/* ========== CORRECT SALE ITEMS MODAL ========== */}
      <Modal open={showCorrect} onClose={() => setShowCorrect(false)} title={`${t("correct_sale")}: ${selectedSale?.voucherNo || ""}`} size="lg">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div className="space-y-2 mb-3">
          {correctItems.map((item, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <div><label className="block text-xs text-gray-500 mb-1">{t("product")}</label><select value={item.productId} onChange={e => { const v = parseInt(e.target.value); setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, productId: v, lotId: 0 } : c)); }} className="select-field text-sm"><option value={0}>{t("select_product")}</option>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("lot")}</label><select value={item.lotId || 0} disabled={isSaleItemLotLocked(item)} onChange={e => { const v = parseInt(e.target.value); setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, lotId: v } : c)); }} className="select-field text-sm disabled:bg-gray-100 disabled:text-gray-500"><option value={0}>Auto</option>{lotOptionsForItem(item, true).map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}{l.status === "completed" ? " ✓" : ""}</option>)}</select>{autoLotAllocationPreview(item, true) && <p className="mt-1 text-[11px] text-blue-700">{autoLotAllocationPreview(item, true)}</p>}</div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("cartons")}</label><input type="number" value={item.qty || ""} onChange={e => { const v = parseFloat(e.target.value) || 0; setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, qty: v } : c)); }} className="input-field text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("rate_per_carton")}</label><input type="number" value={item.ratePerCarton || ""} onChange={e => { const v = parseFloat(e.target.value) || 0; setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, ratePerCarton: v } : c)); }} className="input-field text-sm" /></div>
              <div className="flex gap-1 items-center"><span className="text-sm text-gray-600">{((item.qty || 0) * (item.ratePerCarton || 0)).toLocaleString("en-US")}</span>{correctItems.length > 1 && <button onClick={() => setCorrectItems(ci => ci.filter((_, idx) => idx !== i))} className="text-red-500 text-lg">×</button>}</div>
            </div>
          ))}
          <button onClick={() => setCorrectItems(ci => [...ci, emptySaleItem()])} className="text-xs text-primary-600 hover:underline">+ {t("add_item")}</button>
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("cancel_reason")} *</label><input value={correctReason} onChange={e => setCorrectReason(e.target.value)} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCorrect} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("correct_sale")}</button>
        </div>
      </Modal>

      {/* HARD DELETE 2FA MODAL */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("hard_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("permanent_delete_warning")}</p>
            <p>Sale: <span className="font-bold">{hardDeleteTarget?.voucherNo}</span></p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_admin_password")}</label>
            <input
              type="password"
              value={hardDeletePassword}
              onChange={e => setHardDeletePassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleHardDelete()}
              className="input-field"
              placeholder={t("password")}
              autoFocus
            />
          </div>
          {hardDeleteError && <p className="text-sm text-red-600">{hardDeleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={handleHardDelete} disabled={hardDeleteSubmitting} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {hardDeleteSubmitting ? "..." : t("hard_delete")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
