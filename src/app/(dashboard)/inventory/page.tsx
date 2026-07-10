"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, Modal, formatNumber, MobileDateInput, RowActionMenu, PaginationBar } from "@/components/ui";
import { DEFAULT_LIST_PAGE_SIZE, paginateList } from "@/lib/pagination";
import { GlassButton } from "@/components/ui/GlassButton";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { countPendingInterGodownTransfers } from "@/lib/offline-inventory";
import { applyQueuedMutationsToPendingTransfers } from "@/lib/offline-remaining-mutations";
import { ArrowLeftRight, MessageSquare, PackagePlus, Repeat, Warehouse } from "lucide-react";
import {
  formatInventoryDate,
  formatStockMovementType,
  stockMovementTypeClass,
} from "@/lib/stock-movement-display";
import { shouldSimplifyCityModals } from "@/lib/quickform-embed";
import { isSeedGodownName } from "@/lib/seed-godown-names";

const INVENTORY_READ_CACHE_KEY = "mrf-inventory-read-cache-v1";
const CITY_TRANSFER_FORM_CACHE_KEY = "mrf-city-transfers-form-cache-v1";

type CityTransferFormCache = {
  cities: any[];
  products: any[];
  lots: any[];
};

type InventoryReadSnapshot = {
  data: any | null;
  pendingTransfers: any[];
  lots: any[];
  ledger: any[];
  godownList: any[];
  productList: any[];
};

export default function InventoryPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems, enqueue } = useOffline();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);
  const [pendingInterGodownCount, setPendingInterGodownCount] = useState(0);
  const [showApprove, setShowApprove] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [myGodowns, setMyGodowns] = useState<any[]>([]);
  const [approveForm, setApproveForm] = useState({ toGodownId: 0, approvalNotes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [approveError, setApproveError] = useState("");

  // Lot distributions for godown assignment
  const [lots, setLots] = useState<any[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  // Stock Ledger
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerGodownId, setLedgerGodownId] = useState(0);
  const [ledgerProductId, setLedgerProductId] = useState(0);
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotalPages, setLedgerTotalPages] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [godownList, setGodownList] = useState<any[]>([]);
  const [productList, setProductList] = useState<any[]>([]);
  const [showAssignedRows, setShowAssignedRows] = useState(false);
  const [superAdminSummaryView, setSuperAdminSummaryView] = useState<"country" | "city">("country");

  // Inter-godown transfer
  const [showInterGodownTransfer, setShowInterGodownTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromGodownId: 0,
    toGodownId: 0,
    productId: 0,
    lotId: 0,
    qty: 0,
    transferDate: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [transferError, setTransferError] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferHelpersLoading, setTransferHelpersLoading] = useState(false);

  // Godown allocation modal
  const [showGodownAlloc, setShowGodownAlloc] = useState(false);
  const [godownAllocs, setGodownAllocs] = useState<any[]>([]);
  const [selectedDist, setSelectedDist] = useState<any>(null);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [godownSubmitting, setGodownSubmitting] = useState(false);
  const [godownError, setGodownError] = useState("");

  const [showGodownManage, setShowGodownManage] = useState(false);
  const [godownManageList, setGodownManageList] = useState<any[]>([]);
  const [godownManageLoading, setGodownManageLoading] = useState(false);
  const [godownOpenActionId, setGodownOpenActionId] = useState<number | null>(null);
  const [showCreateGodown, setShowCreateGodown] = useState(false);
  const [createGodownForm, setCreateGodownForm] = useState({ name: "" });
  const [createGodownError, setCreateGodownError] = useState("");
  const [createGodownSubmitting, setCreateGodownSubmitting] = useState(false);
  const [showEditGodown, setShowEditGodown] = useState(false);
  const [selectedGodown, setSelectedGodown] = useState<any>(null);
  const [editGodownForm, setEditGodownForm] = useState({ name: "" });
  const [editGodownError, setEditGodownError] = useState("");
  const [editGodownSubmitting, setEditGodownSubmitting] = useState(false);

  const [showNewGoods, setShowNewGoods] = useState(false);

  const [showCityTransfer, setShowCityTransfer] = useState(false);
  const [cityTransferLoading, setCityTransferLoading] = useState(false);
  const [cityTransferSubmitting, setCityTransferSubmitting] = useState(false);
  const [cityTransferError, setCityTransferError] = useState("");
  const [cityTransferCities, setCityTransferCities] = useState<any[]>([]);
  const [cityTransferProducts, setCityTransferProducts] = useState<any[]>([]);
  const [cityTransferLots, setCityTransferLots] = useState<any[]>([]);
  const [cityTransferForm, setCityTransferForm] = useState({
    toCityId: 0,
    productId: 0,
    qty: 0,
    lotId: 0,
    transferDate: new Date().toISOString().split("T")[0],
  });

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<InventoryReadSnapshot>(INVENTORY_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<InventoryReadSnapshot>) => {
    const existing = readSnapshot()?.data || {
      data: null,
      pendingTransfers: [],
      lots: [],
      ledger: [],
      godownList: [],
      productList: [],
    };
    writeOfflineReadSnapshot<InventoryReadSnapshot>(INVENTORY_READ_CACHE_KEY, {
      ...existing,
      ...partial,
    });
  }, [readSnapshot]);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    const [invRes, trRes] = await Promise.all([
      apiCall("/api/v1/inventory"),
      apiCall("/api/v1/city-transfers", { params: { limit: 100 } }),
    ]);
    const snapshot = readSnapshot()?.data;
    if (invRes.success) {
      setData(invRes.data);
      mergeSnapshot({ data: invRes.data });
      setShowOfflineSnapshot(false);
    } else if (!isOnline && snapshot?.data) {
      setData(snapshot.data);
      setShowOfflineSnapshot(true);
    }
    if (trRes.success) {
      let pending = (trRes.data as any[]).filter(
        (tr: any) => tr.status === "pending" && tr.toCity?.id === user?.cityId
      );
      pending = applyQueuedMutationsToPendingTransfers(pending, queuedItems as any[]);
      setPendingTransfers(pending);
      mergeSnapshot({ pendingTransfers: pending });
      setShowOfflineSnapshot(false);
    } else if (!isOnline && snapshot?.pendingTransfers) {
      setPendingTransfers(applyQueuedMutationsToPendingTransfers(snapshot.pendingTransfers, queuedItems as any[]));
      setShowOfflineSnapshot(true);
    }
    setPendingInterGodownCount(countPendingInterGodownTransfers(queuedItems as any));
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot, user?.cityId]);

  const loadLots = useCallback(async () => {
    if (user?.role !== "city_admin") return;
    setLotsLoading(true);
    let page = 1;
    let totalPages = 1;
    const allLots: any[] = [];
    do {
      const r = await apiCall("/api/v1/lots", { params: { limit: 200, page } });
      if (!r.success) break;
      allLots.push(...((r.data as any[]) || []));
      totalPages = (r.pagination as any)?.totalPages || 1;
      page += 1;
    } while (page <= totalPages);
    if (allLots.length > 0) {
      setLots(allLots);
      mergeSnapshot({ lots: allLots });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.lots?.length) {
        setLots(snapshot.lots);
        setShowOfflineSnapshot(true);
      }
    }
    setLotsLoading(false);
  }, [isOnline, mergeSnapshot, readSnapshot, user?.role]);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    const params: Record<string, string | number> = {
      page: ledgerPage,
      limit: DEFAULT_LIST_PAGE_SIZE,
    };
    if (ledgerGodownId) params.godown_id = ledgerGodownId;
    if (ledgerProductId) params.product_id = ledgerProductId;
    if (ledgerDateFrom) params.date_from = ledgerDateFrom;
    if (ledgerDateTo) params.date_to = ledgerDateTo;
    const r = await apiCall("/api/v1/inventory/stock-ledger", { params });
    if (r.success) {
      setLedger(r.data as any[]);
      const pagination = r.pagination as { totalPages?: number; total?: number } | undefined;
      setLedgerTotalPages(pagination?.totalPages || 1);
      setLedgerTotal(pagination?.total ?? (r.data as any[])?.length ?? 0);
      mergeSnapshot({ ledger: r.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.ledger?.length) {
        const paged = paginateList(snapshot.ledger, ledgerPage, DEFAULT_LIST_PAGE_SIZE);
        setLedger(paged.items as any[]);
        setLedgerTotalPages(paged.pagination.totalPages);
        setLedgerTotal(paged.pagination.total);
        setShowOfflineSnapshot(true);
      }
    }
    setLedgerLoading(false);
  }, [isOnline, ledgerGodownId, ledgerProductId, ledgerDateFrom, ledgerDateTo, ledgerPage, mergeSnapshot, readSnapshot]);

  const loadLedgerHelpers = useCallback(async () => {
    const [gR, pR] = await Promise.all([
      apiCall("/api/v1/godowns", { params: { limit: 100 } }),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
    ]);
    if (gR.success) {
      setGodownList(gR.data as any[]);
      mergeSnapshot({ godownList: gR.data as any[] });
      setShowOfflineSnapshot(false);
    }
    if (pR.success) {
      setProductList(pR.data as any[]);
      mergeSnapshot({ productList: pR.data as any[] });
      setShowOfflineSnapshot(false);
    }
    if ((!gR.success || !pR.success) && !isOnline) {
      const snapshot = readSnapshot()?.data;
      if (!gR.success && snapshot?.godownList?.length) {
        setGodownList(snapshot.godownList);
        setShowOfflineSnapshot(true);
      }
      if (!pR.success && snapshot?.productList?.length) {
        setProductList(snapshot.productList);
        setShowOfflineSnapshot(true);
      }
    }
  }, [isOnline, mergeSnapshot, readSnapshot]);

  const openInterGodownTransfer = async () => {
    setTransferHelpersLoading(true);
    setTransferError("");
    setTransferForm({
      fromGodownId: 0,
      toGodownId: 0,
      productId: 0,
      lotId: 0,
      qty: 0,
      transferDate: new Date().toISOString().split("T")[0],
      notes: "",
    });
    const [gR, pR, lR] = await Promise.all([
      apiCall("/api/v1/godowns", { params: { limit: 100 } }),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
    ]);
    const snapshot = readSnapshot()?.data;
    if (gR.success) {
      const liveGodowns = (gR.data as any[]).filter((g: any) => g.cityId === user?.cityId && g.isActive);
      setGodownList(liveGodowns);
      mergeSnapshot({ godownList: gR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline && snapshot?.godownList?.length) {
      setGodownList(snapshot.godownList.filter((g: any) => g.cityId === user?.cityId && g.isActive));
      setShowOfflineSnapshot(true);
    }
    if (pR.success) {
      setProductList(pR.data as any[]);
      mergeSnapshot({ productList: pR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline && snapshot?.productList?.length) {
      setProductList(snapshot.productList);
      setShowOfflineSnapshot(true);
    }
    if (lR.success) {
      setLots(lR.data as any[]);
      mergeSnapshot({ lots: lR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline && snapshot?.lots?.length) {
      setLots(snapshot.lots);
      setShowOfflineSnapshot(true);
    }
    setTransferHelpersLoading(false);
    setShowInterGodownTransfer(true);
  };

  const handleInterGodownTransfer = async () => {
    setTransferError("");
    if (!transferForm.fromGodownId || !transferForm.toGodownId || !transferForm.productId || !(transferForm.qty > 0)) {
      setTransferError("Please select source godown, destination godown, product, and a positive quantity.");
      return;
    }
    if (transferForm.fromGodownId === transferForm.toGodownId) {
      setTransferError("Source and destination godown must be different.");
      return;
    }
    setTransferSubmitting(true);
    const body = {
      ...transferForm,
      lotId: transferForm.lotId || undefined,
    };
    const r = await apiCall("/api/v1/godowns/transfers", { method: "POST", body });
    setTransferSubmitting(false);
    if (r.success) {
      setShowInterGodownTransfer(false);
      await loadInventory();
    } else {
      setTransferError(r.error || "Failed to transfer stock");
    }
  };

  useEffect(() => { loadInventory(); }, [loadInventory]);
  useEffect(() => { loadLots(); }, [loadLots]);
  useEffect(() => {
    if (user?.role !== "city_admin") return;
    const refresh = () => {
      void loadInventory();
      void loadLedger();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [loadInventory, loadLedger, user?.role]);
  useEffect(() => {
    setLedgerPage(1);
  }, [ledgerGodownId, ledgerProductId, ledgerDateFrom, ledgerDateTo]);

  useEffect(() => { loadLedger(); }, [loadLedger]);
  useEffect(() => { loadLedgerHelpers(); }, [loadLedgerHelpers]);

  const openApprove = async (tr: any) => {
    setSelected(tr);
    const gR = await apiCall("/api/v1/godowns", { params: { limit: 100 } });
    if (gR.success) {
      const liveGodowns = (gR.data as any[]).filter((g: any) => g.cityId === user?.cityId);
      setMyGodowns(liveGodowns);
      mergeSnapshot({ godownList: gR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.godownList?.length) {
        setMyGodowns(snapshot.godownList.filter((g: any) => g.cityId === user?.cityId));
        setShowOfflineSnapshot(true);
      } else {
        setMyGodowns([]);
      }
    }
    setApproveForm({ toGodownId: 0, approvalNotes: "" });
    setShowApprove(true);
    setApproveError("");
  };

  const handleApprove = async () => {
    if (!approveForm.toGodownId) { setApproveError(t("select_godown")); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/city-transfers/${selected.id}`, {
      method: "PUT",
      body: { action: "approve", ...approveForm },
    });
    setSubmitting(false);
    if (r.success) { setShowApprove(false); loadInventory(); loadLedger(); }
    else { setApproveError(r.error || "Failed"); }
  };

  const handleReject = async (tr: any) => {
    const reason = prompt(t("reason_for_rejection"));
    if (!reason) return;
    await apiCall(`/api/v1/city-transfers/${tr.id}`, {
      method: "PUT",
      body: { action: "reject", approvalNotes: reason },
    });
    loadInventory();
    loadLedger();
  };

  // ── Godown allocation ──────────────────────────────────────────────────────
  const openGodownAlloc = async (lot: any, dist: any) => {
    setSelectedDist(dist); setSelectedLot(lot); setGodownError("");
    const gRes = await apiCall("/api/v1/godowns", { params: { city_id: dist.cityId, limit: 50 } });
    let godowns: any[] = [];
    if (gRes.success) {
      godowns = ((gRes.data || []) as any[]).filter((g: any) => g.isActive);
      mergeSnapshot({ godownList: gRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      godowns = (snapshot?.godownList || []).filter((g: any) => g.cityId === dist.cityId && g.isActive);
      if (godowns.length) setShowOfflineSnapshot(true);
    }
    const allocs: any[] = godowns.map((gd: any) => {
      const ex = dist.godownAllocations?.find((ga: any) => ga.godownId === gd.id);
      return { productId: dist.productId, productName: dist.productName, godownId: gd.id, godownName: gd.name, qty: ex?.qty || 0, maxQty: Number(dist.allocatedQty) };
    });
    setGodownAllocs(allocs); setShowGodownAlloc(true);
  };

  const godownEvenSplit = () => {
    if (!godownAllocs.length) return;
    const max = godownAllocs[0]?.maxQty || 0;
    const perGodown = Math.floor(max / godownAllocs.length);
    const remainder = max - perGodown * godownAllocs.length;
    setGodownAllocs(prev => prev.map((a, i) => ({ ...a, qty: perGodown + (i === 0 ? remainder : 0) })));
  };

  const godownAllToOne = (godownId: number) => {
    const max = godownAllocs[0]?.maxQty || 0;
    setGodownAllocs(prev => prev.map(a => ({ ...a, qty: a.godownId === godownId ? max : 0 })));
  };

  const handleGodownAlloc = async () => {
    setGodownSubmitting(true); setGodownError("");
    const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
    const maxQty = godownAllocs[0]?.maxQty || 0;
    if (totalAlloc > maxQty) { setGodownError(`Total ${totalAlloc} exceeds allocated qty ${maxQty}`); setGodownSubmitting(false); return; }
    const validAllocs = godownAllocs.filter(a => a.qty > 0).map(({ godownId, qty }: any) => ({ godownId, qty }));
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/godown-allocation`, {
      method: "POST",
      body: { cityId: selectedDist.cityId, productId: selectedDist.productId, allocations: validAllocs },
    });
    setGodownSubmitting(false);
    if (r.success) { setShowGodownAlloc(false); loadInventory(); loadLots(); }
    else { setGodownError(r.error || "Failed"); }
  };

  const refreshGodownManageList = async () => {
    setGodownManageLoading(true);
    const r = await apiCall("/api/v1/godowns", { params: { limit: 100, is_active: "true" } });
    if (r.success) {
      const rows = (r.data as any[]).filter((g: any) => g.cityId === user?.cityId && g.isActive !== false);
      setGodownManageList(rows);
      mergeSnapshot({ godownList: r.data as any[] });
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.godownList?.length) {
        setGodownManageList(snapshot.godownList.filter((g: any) => g.cityId === user?.cityId && g.isActive));
      }
    }
    setGodownManageLoading(false);
  };

  const openGodownManage = async () => {
    setGodownOpenActionId(null);
    setShowGodownManage(true);
    await refreshGodownManageList();
  };

  const openCreateGodown = () => {
    setCreateGodownForm({ name: "" });
    setCreateGodownError("");
    setShowCreateGodown(true);
  };

  const handleCreateGodown = async () => {
    const name = createGodownForm.name.trim();
    if (!name) {
      setCreateGodownError(`${t("name")} ${t("reason_required").toLowerCase()}`);
      return;
    }
    if (!user?.cityId) {
      setCreateGodownError("City scope required");
      return;
    }
    setCreateGodownSubmitting(true);
    setCreateGodownError("");
    const result = await apiCall("/api/v1/godowns", {
      method: "POST",
      body: { name, cityId: user.cityId },
    });
    setCreateGodownSubmitting(false);
    if (result.success) {
      setShowCreateGodown(false);
      await loadLedgerHelpers();
      await loadInventory();
      await loadLots();
      if (showGodownManage) await refreshGodownManageList();
    } else {
      setCreateGodownError(result.error || "Failed to create godown");
    }
  };

  const openEditGodown = (g: any) => {
    setSelectedGodown(g);
    setEditGodownForm({ name: g.name });
    setEditGodownError("");
    setShowEditGodown(true);
  };

  const handleEditGodown = async () => {
    if (!selectedGodown) return;
    if (isSeedGodownName(selectedGodown.name)) {
      setEditGodownError("Default godown names cannot be changed");
      return;
    }
    const name = editGodownForm.name.trim();
    if (!name) {
      setEditGodownError(`${t("name")} ${t("reason_required").toLowerCase()}`);
      return;
    }
    setEditGodownSubmitting(true);
    setEditGodownError("");
    const result = await apiCall(`/api/v1/godowns/${selectedGodown.id}`, { method: "PUT", body: { name } });
    setEditGodownSubmitting(false);
    if (result.success) {
      setShowEditGodown(false);
      setGodownManageList((prev) => prev.map((row) => (row.id === selectedGodown.id ? { ...row, name } : row)));
      await loadLedgerHelpers();
      await refreshGodownManageList();
    } else {
      setEditGodownError(result.error || "Failed to update godown");
    }
  };

  const handleDeactivateGodown = async (g: any) => {
    if (!confirm(`"${g.name}": ${t("confirm_deactivate_godown")}`)) return;
    const result = await apiCall(`/api/v1/godowns/${g.id}`, { method: "PUT", body: { isActive: false } });
    if (result.success) {
      setGodownManageList((prev) => prev.filter((row) => row.id !== g.id));
      await loadLedgerHelpers();
      await refreshGodownManageList();
    } else {
      alert(result.error || "Failed to deactivate godown");
    }
  };

  const openNewGoods = async () => {
    setShowAssignedRows(false);
    setShowNewGoods(true);
    if (!lots.length && !lotsLoading) await loadLots();
  };

  const loadCityTransferHelpers = async () => {
    const [cR, gR, pR, lR] = await Promise.all([
      apiCall("/api/v1/cities", { params: { all: "true" } }),
      apiCall("/api/v1/godowns", { params: { limit: 100 } }),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
    ]);
    const nextCities = cR.success
      ? (cR.data as any[]).filter((c: any) => c.id !== user?.cityId && c.countryName === user?.countryName)
      : [];
    const nextGodowns = gR.success ? (gR.data as any[]).filter((g: any) => g.cityId === user?.cityId && g.isActive) : [];
    const nextProducts = pR.success ? (pR.data as any[]).filter((p: any) => p.isActive !== false) : [];
    const nextLots = lR.success ? (lR.data as any[]) : [];
    if (cR.success) setCityTransferCities(nextCities);
    if (gR.success) setGodownList(nextGodowns);
    if (pR.success) setCityTransferProducts(nextProducts);
    if (lR.success) setCityTransferLots(nextLots);
    if (nextCities.length > 0 && nextProducts.length > 0) {
      writeOfflineFormCache<CityTransferFormCache>(CITY_TRANSFER_FORM_CACHE_KEY, {
        cities: nextCities,
        products: nextProducts,
        lots: nextLots,
      });
    }
    return { nextCities, nextProducts, nextLots };
  };

  const openCityTransfer = async () => {
    setCityTransferError("");
    setCityTransferForm({
      toCityId: 0,
      productId: 0,
      qty: 0,
      lotId: 0,
      transferDate: new Date().toISOString().split("T")[0],
    });
    setShowCityTransfer(true);
    setCityTransferLoading(true);

    if (!isOnline) {
      const cached = readOfflineFormCache<CityTransferFormCache>(CITY_TRANSFER_FORM_CACHE_KEY, ["cities", "products", "lots"]);
      if (!cached) {
        setCityTransferError(
          getOfflineFormReadinessError({ isOnline, currencyCount: 0, moduleTitle: "City Transfer" }) || "Offline setup missing",
        );
        setCityTransferLoading(false);
        return;
      }
      setCityTransferCities(cached.cities);
      setCityTransferProducts(cached.products);
      setCityTransferLots(cached.lots);
      setCityTransferLoading(false);
      return;
    }

    await loadCityTransferHelpers();
    setCityTransferLoading(false);
  };

  const resolveCityTransferFromGodown = async (): Promise<number | null> => {
    const stockRes = await apiCall("/api/v1/inventory/godown-stock");
    if (stockRes.success) {
      const rows = ((stockRes.data as any[]) || [])
        .filter((row) => row.godownId)
        .sort((a, b) => Number(b.available) - Number(a.available));
      if (rows.length) return rows[0].godownId;
    }
    if (godownList.length === 1) return godownList[0].id;
    if (godownList.length > 1) return godownList[0].id;
    return null;
  };

  const handleCityTransferSend = async () => {
    setCityTransferError("");
    if (!cityTransferForm.toCityId || !cityTransferForm.productId || !(cityTransferForm.qty > 0)) {
      setCityTransferError(t("fill_required_fields"));
      return;
    }

    const fromGodownId = await resolveCityTransferFromGodown();
    if (!fromGodownId) {
      setCityTransferError("No active godown found for this city.");
      return;
    }

    const body: any = {
      toCityId: cityTransferForm.toCityId,
      fromGodownId,
      productId: cityTransferForm.productId,
      qty: cityTransferForm.qty,
      transferDate: cityTransferForm.transferDate,
    };
    if (cityTransferForm.lotId) body.lotId = cityTransferForm.lotId;

    if (!isOnline) {
      const toCity = cityTransferCities.find((c: any) => c.id === cityTransferForm.toCityId);
      const product = cityTransferProducts.find((p: any) => p.id === cityTransferForm.productId);
      const lot = cityTransferLots.find((l: any) => l.id === cityTransferForm.lotId);
      await enqueue({
        url: "/api/v1/city-transfers",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/inventory",
        auditMeta: {
          action: "create",
          entityType: "city_transfer",
          entityLabel: "City Transfer (Pending)",
          entityDetail: `${product?.name || "Product"} × ${Number(cityTransferForm.qty || 0).toLocaleString("en-US")} → ${toCity?.name || "City"}`,
        },
      });
      setShowCityTransfer(false);
      return;
    }

    setCityTransferSubmitting(true);
    const r = await apiCall("/api/v1/city-transfers", { method: "POST", body });
    setCityTransferSubmitting(false);
    if (r.success) {
      setShowCityTransfer(false);
      await loadInventory();
      await loadLedger();
    } else {
      setCityTransferError(r.error || "Failed to send transfer");
    }
  };

  if (loading || !data) {
    return (
      <div>
        <PageHeader title={t("inventory")} />
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const isCityAdmin = user?.role === "city_admin";
  const simplifyCityUI = shouldSimplifyCityModals(user, false);

  const inventorySummaryRows = user?.role === "super_admin"
    ? [
        { type: "overall", name: "Grand Total", scopeName: "-", qty: Number(data.grandTotalQty || 0) },
        ...((superAdminSummaryView === "country" ? (data.countrySummary || []) : (data.citySummary || [])).map((entry: any) => ({
          type: superAdminSummaryView,
          name: superAdminSummaryView === "country" ? entry.countryName : entry.cityName,
          scopeName: superAdminSummaryView === "country" ? "All Cities" : (entry.countryName || "-"),
          qty: Number(entry.totalQty || 0),
        }))),
      ]
    : [
        { type: "overall", name: "Grand Total", scopeName: "-", qty: Number(data.grandTotalQty || 0) },
        ...((data.productsSummary || []).map((p: any) => ({
          type: "product",
          name: p.productName,
          scopeName: "All Godowns",
          qty: Number(p.totalQty || 0),
        }))),
        ...((data.godownsSummary || []).map((g: any) => ({
          type: "godown",
          name: g.godownName,
          scopeName: g.cityName,
          qty: Number(g.totalQty || 0),
        }))),
      ];

  const lotAssignmentRows: { lot: any; dist: any; assigned: number; remaining: number; isDone: boolean; hasExistingAllocations: boolean }[] = [];
  for (const lot of lots) {
    for (const dist of lot.distributions || []) {
      if (dist.cityId !== user?.cityId) continue;
      const assigned = (dist.godownAllocations || []).reduce((s: number, ga: any) => s + Number(ga.qty), 0);
      const remaining = Number(dist.allocatedQty) - assigned;
      lotAssignmentRows.push({
        lot,
        dist,
        assigned,
        remaining,
        isDone: remaining <= 0,
        hasExistingAllocations: assigned > 0,
      });
    }
  }
  const newAssignmentRows = lotAssignmentRows.filter((row) => !row.hasExistingAllocations);
  const existingAssignmentRows = lotAssignmentRows.filter((row) => row.hasExistingAllocations);
  const pendingNewGoodsCount = newAssignmentRows.length;

  return (
    <div>
      <PageHeader title={t("inventory")} />
      {isCityAdmin && (
        <div className="mb-4 flex flex-wrap gap-2">
          <GlassButton variant="secondary" onClick={() => { void openCityTransfer(); }}>
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("city_transfers")}
          </GlassButton>
          <GlassButton variant="secondary" onClick={() => { void openGodownManage(); }}>
            <Warehouse className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("godown")}
          </GlassButton>
          <GlassButton variant="secondary" onClick={() => { void openInterGodownTransfer(); }}>
            <Repeat className="h-3.5 w-3.5" strokeWidth={1.75} />
            Inter-Godown
          </GlassButton>
          <div className="relative">
            <GlassButton variant="secondary" onClick={() => { void openNewGoods(); }}>
              <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
              New Goods
            </GlassButton>
            {pendingNewGoodsCount > 0 && (
              <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                <MessageSquare className="h-2.5 w-2.5" strokeWidth={2.5} />
                {pendingNewGoodsCount > 99 ? "99+" : pendingNewGoodsCount}
              </span>
            )}
          </div>
        </div>
      )}
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached inventory data for this device.
        </div>
      )}

      {/* Pending Incoming City Transfers — notification banner */}
      {pendingTransfers.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl shadow-sm">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            📦 {pendingTransfers.length} {t("incoming_transfers")} — {t("action_required") || "Action Required"}
          </p>
          <div className="space-y-2">
            {pendingTransfers.map((tr: any) => (
              <div key={tr.id} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-4 py-2.5 text-sm shadow-sm">
                <div>
                  <span className="font-medium text-gray-800">{tr.product?.name}</span>
                  <span className="text-gray-500 mx-1">×</span>
                  <span className="font-bold text-gray-900">{tr.qty}</span>
                  <span className="text-gray-400 ml-1">{t("cartons")}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-gray-500">{t("from")} <strong className="text-gray-700">{tr.fromCity?.name}</strong></span>
                  {tr.fromGodown && (
                    <span className="text-xs text-gray-400 ml-1">({tr.fromGodown.name})</span>
                  )}
                  {tr.lot && (
                    <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                      {tr.lot.lotNumber}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => openApprove(tr)}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    ✓ {t("approve")}
                  </button>
                  <button
                    onClick={() => handleReject(tr)}
                    className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-3 py-1.5 rounded-lg transition-colors border border-red-200"
                  >
                    ✗ {t("reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingInterGodownCount > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl shadow-sm">
          <p className="text-sm font-semibold text-amber-800">
            {pendingInterGodownCount} pending inter-godown transfer{pendingInterGodownCount > 1 ? "s" : ""} (offline queue)
          </p>
          <p className="text-xs text-amber-700 mt-1">
            These transfers are saved locally and will sync automatically when internet returns.
          </p>
        </div>
      )}

      <div className="card mb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isCityAdmin ? "Stock Summary" : "Inventory Summary"}
            </h2>
            {isCityAdmin && user?.cityName && (
              <p className="mt-0.5 text-xs text-gray-500">{user.cityName}</p>
            )}
          </div>
          {user?.role === "super_admin" && (
            <select
              value={superAdminSummaryView}
              onChange={(e) => setSuperAdminSummaryView((e.target.value as "country" | "city") || "country")}
              className="select-field h-9 w-44 text-sm"
            >
              <option value="country">Country-wise</option>
              <option value="city">City-wise</option>
            </select>
          )}
        </div>
        <div className="module-scroll-x">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/90">
              <tr>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Category</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {isCityAdmin ? "Item" : "Name"}
                </th>
                {!isCityAdmin && (
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Scope</th>
                )}
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cartons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inventorySummaryRows.map((row: any, index: number) => (
                  <tr key={`${row.type}-${row.name}-${index}`} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        row.type === "overall"
                          ? "bg-primary-50 text-primary-700 border-primary-100"
                          : row.type === "product"
                            ? "bg-gray-100 text-gray-700 border-gray-200"
                            : row.type === "country"
                              ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                              : row.type === "city"
                                ? "bg-cyan-50 text-cyan-700 border-cyan-100"
                            : "bg-blue-50 text-blue-700 border-blue-100"
                      }`}>
                        {row.type === "overall"
                          ? (isCityAdmin ? "Total" : "Overall")
                          : row.type === "product"
                            ? "Product"
                            : row.type === "country"
                              ? "Country"
                              : row.type === "city"
                                ? "City"
                                : "Godown"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{row.name}</td>
                    {!isCityAdmin && (
                      <td className="px-3 py-2.5 text-gray-500">{row.scopeName}</td>
                    )}
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatNumber(row.qty)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {isCityAdmin && <div className="card mt-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Stock Movements</h2>
            <p className="text-xs text-gray-500">Receipts, issues, transfers, and sales by godown.</p>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Godown</label>
            <select value={ledgerGodownId} onChange={e => setLedgerGodownId(parseInt(e.target.value))} className="select-field text-sm">
              <option value={0}>All Godowns</option>
              {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Product</label>
            <select value={ledgerProductId} onChange={e => setLedgerProductId(parseInt(e.target.value))} className="select-field text-sm">
              <option value={0}>All Products</option>
              {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">From</label>
            <input type="date" value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">To</label>
            <input type="date" value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} className="input-field text-sm" />
          </div>
        </div>
        {ledgerLoading ? (
          <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
        ) : ledger.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No stock movements found for the selected filters.</p>
        ) : (
          <div className="module-scroll-x rounded-xl border border-gray-200">
            <table className={`w-full text-sm ${simplifyCityUI ? "min-w-[980px]" : "min-w-[880px]"}`}>
              <thead className="border-b border-gray-200 bg-gray-50/90">
                <tr>
                  {simplifyCityUI ? (
                    <>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ref. No.</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Product</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Qty In</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-red-600">Qty Out</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-600">Balance</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Godown</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("customer")}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ref. No.</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Product</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Godown</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Qty In</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-red-600">Qty Out</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-600">Balance</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map((row: any, index: number) => {
                  const movementType = formatStockMovementType(row.type);
                  return (
                  <tr key={`${row.reference}-${index}`} className="hover:bg-gray-50/60">
                    {simplifyCityUI ? (
                      <>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{row.reference || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">{formatInventoryDate(row.date)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stockMovementTypeClass[movementType.tone]}`}>
                            {movementType.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-800">{row.productName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{row.qtyIn ? formatNumber(row.qtyIn) : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{row.qtyOut ? formatNumber(row.qtyOut) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatNumber(row.runningStock || 0)}</td>
                        <td className="px-3 py-2.5 text-gray-700">{row.godownName}</td>
                        <td className="px-3 py-2.5 text-gray-700">{row.customerName || "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">{formatInventoryDate(row.date)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stockMovementTypeClass[movementType.tone]}`}>
                            {movementType.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{row.reference || "—"}</td>
                        <td className="px-3 py-2.5 text-gray-800">{row.productName}</td>
                        <td className="px-3 py-2.5 text-gray-700">{row.godownName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{row.qtyIn ? formatNumber(row.qtyIn) : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{row.qtyOut ? formatNumber(row.qtyOut) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatNumber(row.runningStock || 0)}</td>
                      </>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!ledgerLoading && ledgerTotalPages > 1 && (
          <div className="mt-4">
            <PaginationBar
              bordered={false}
              pagination={{
                page: ledgerPage,
                totalPages: ledgerTotalPages,
                total: ledgerTotal,
                pageSize: DEFAULT_LIST_PAGE_SIZE,
                onPageChange: setLedgerPage,
              }}
            />
          </div>
        )}
      </div>}

      {/* Approve Transfer Modal */}
      <Modal open={showApprove} onClose={() => setShowApprove(false)} title={t("approve_transfer")} size="md">
        {approveError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{approveError}</div>
        )}
        {selected && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
            {t("received")} <strong>{selected.qty} {t("cartons")}</strong> {t("of")}{" "}
            <strong>{selected.product?.name}</strong> {t("from")}{" "}
            <strong>{selected.fromCity?.name}</strong>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label>
            <select
              value={approveForm.toGodownId}
              onChange={e => setApproveForm(f => ({ ...f, toGodownId: parseInt(e.target.value) }))}
              className="select-field"
            >
              <option value={0}>{t("select_godown")}</option>
              {myGodowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input
              value={approveForm.approvalNotes}
              onChange={e => setApproveForm(f => ({ ...f, approvalNotes: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleApprove} disabled={submitting} className="btn-primary text-sm">
            {submitting ? "..." : t("approve_receive")}
          </button>
        </div>
      </Modal>

      <Modal open={showCityTransfer} onClose={() => setShowCityTransfer(false)} title={t("send_goods_to_city")} size="md">
        {cityTransferError && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{cityTransferError}</div>
        )}
        {cityTransferLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("date")} *</label>
                  <MobileDateInput
                    variant="field"
                    value={cityTransferForm.transferDate}
                    onChange={(transferDate) => setCityTransferForm((f) => ({ ...f, transferDate }))}
                    placeholder={t("date")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("to_city_label")} *</label>
                  <select
                    value={cityTransferForm.toCityId}
                    onChange={(e) => setCityTransferForm((f) => ({ ...f, toCityId: parseInt(e.target.value, 10) || 0 }))}
                    className="select-field"
                  >
                    <option value={0}>{t("select_city")}</option>
                    {cityTransferCities.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("product")} *</label>
                  <select
                    value={cityTransferForm.productId}
                    onChange={(e) => setCityTransferForm((f) => ({ ...f, productId: parseInt(e.target.value, 10) || 0 }))}
                    className="select-field"
                  >
                    <option value={0}>{t("select")}</option>
                    {cityTransferProducts.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("cartons")} *</label>
                  <input
                    type="number"
                    min="0.01"
                    value={cityTransferForm.qty || ""}
                    onChange={(e) => setCityTransferForm((f) => ({ ...f, qty: parseFloat(e.target.value) || 0 }))}
                    className="input-field"
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("lot")}</label>
                <select
                  value={cityTransferForm.lotId}
                  onChange={(e) => setCityTransferForm((f) => ({ ...f, lotId: parseInt(e.target.value, 10) || 0 }))}
                  className="select-field"
                >
                  <option value={0}>{t("auto_fifo")}</option>
                  {cityTransferLots
                    .filter((lot: any) => lot.status === "ongoing")
                    .map((lot: any) => (
                      <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>
                    ))}
                </select>
              </div>
            </div>
            <p className="mt-3 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
              {t("send_goods_note")}
            </p>
            <div className="mt-4 flex justify-end border-t pt-4">
              <GlassButton variant="primary" onClick={() => { void handleCityTransferSend(); }} disabled={cityTransferSubmitting}>
                {cityTransferSubmitting ? "..." : t("save")}
              </GlassButton>
            </div>
          </>
        )}
      </Modal>

      <Modal open={showInterGodownTransfer} onClose={() => setShowInterGodownTransfer(false)} title="Inter-Godown Transfer" size="md">
        {transferError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{transferError}</div>
        )}
        {transferHelpersLoading ? (
          <div className="py-10 flex justify-center">
            <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {!simplifyCityUI && (
            <div className="mb-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
              Move stock between your godowns without using the city transfer workflow.
            </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
                <MobileDateInput
                  variant="field"
                  value={transferForm.transferDate}
                  onChange={(transferDate) => setTransferForm((f) => ({ ...f, transferDate }))}
                  placeholder={t("date")}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("from_godown")} *</label>
                  <select value={transferForm.fromGodownId} onChange={e => setTransferForm((f) => ({ ...f, fromGodownId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("select_godown")}</option>
                    {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label>
                  <select value={transferForm.toGodownId} onChange={e => setTransferForm((f) => ({ ...f, toGodownId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("select_godown")}</option>
                    {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              {simplifyCityUI ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} *</label>
                    <select value={transferForm.productId} onChange={e => setTransferForm((f) => ({ ...f, productId: parseInt(e.target.value) }))} className="select-field">
                      <option value={0}>{t("select")}</option>
                      {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("qty")} *</label>
                    <input
                      type="number"
                      min="0.01"
                      value={transferForm.qty || ""}
                      onChange={e => setTransferForm((f) => ({ ...f, qty: parseFloat(e.target.value) || 0 }))}
                      className="input-field"
                      onWheel={e => e.currentTarget.blur()}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lot</label>
                      <select value={transferForm.lotId} onChange={e => setTransferForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                        <option value={0}>Auto-select FIFO lot</option>
                        {lots.filter((lot: any) => lot.status === "ongoing").map((lot: any) => <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
                      <input
                        value={transferForm.notes}
                        onChange={e => setTransferForm((f) => ({ ...f, notes: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} *</label>
                      <select value={transferForm.productId} onChange={e => setTransferForm((f) => ({ ...f, productId: parseInt(e.target.value) }))} className="select-field">
                        <option value={0}>{t("select")}</option>
                        {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lot</label>
                      <select value={transferForm.lotId} onChange={e => setTransferForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                        <option value={0}>Auto-select FIFO lot</option>
                        {lots.filter((lot: any) => lot.status === "ongoing").map((lot: any) => <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("qty")} *</label>
                    <input
                      type="number"
                      min="0.01"
                      value={transferForm.qty || ""}
                      onChange={e => setTransferForm((f) => ({ ...f, qty: parseFloat(e.target.value) || 0 }))}
                      className="input-field"
                      onWheel={e => e.currentTarget.blur()}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
                    <input
                      value={transferForm.notes}
                      onChange={e => setTransferForm((f) => ({ ...f, notes: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
              <button onClick={handleInterGodownTransfer} disabled={transferSubmitting} className="btn-primary text-sm">
                {transferSubmitting ? "..." : simplifyCityUI ? "Transfer" : "Transfer Stock"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Godown Allocation Modal ── */}
      <Modal open={showGodownAlloc} onClose={() => setShowGodownAlloc(false)} title={`${t("assign_to_godowns") || "Assign to Godowns"} — ${selectedLot?.lotNumber || ""}`} size="lg">
        {godownError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{godownError}</div>}
        {selectedDist && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
            <strong>{selectedDist.productName}</strong> — Allocated: <strong>{formatNumber(Number(selectedDist.allocatedQty))}</strong> cartons
          </div>
        )}
        {godownAllocs.length > 0 ? (() => {
          const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
          const maxQty = godownAllocs[0]?.maxQty || 0;
          const remaining = maxQty - totalAlloc;
          const isOver = remaining < 0;
          const isDone = remaining === 0;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : isDone ? "bg-green-500" : "bg-primary-500"}`}
                      style={{ width: `${Math.min(100, maxQty > 0 ? (totalAlloc / maxQty) * 100 : 0)}%` }} />
                  </div>
                  <span className={`text-xs font-semibold ${isOver ? "text-red-600" : isDone ? "text-green-600" : "text-gray-500"}`}>
                    {formatNumber(totalAlloc)} / {formatNumber(maxQty)} assigned
                    {isOver ? ` · ⚠ ${formatNumber(Math.abs(remaining))} over` : isDone ? " · ✓ Complete" : ` · ${formatNumber(remaining)} left`}
                  </span>
                </div>
                <button type="button" onClick={godownEvenSplit} className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 hover:border-primary-400 hover:text-primary-600 transition-colors">
                  ÷ Even Split
                </button>
                <button type="button" onClick={() => setGodownAllocs(prev => prev.map(a => ({ ...a, qty: 0 })))} className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 hover:border-red-300 hover:text-red-500 transition-colors">
                  ✕ Clear
                </button>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                <div className="flex items-center gap-3 text-xs font-semibold text-gray-400 pb-1.5 border-b px-1">
                  <span className="w-40">{t("godown")}</span><span className="w-28">{t("qty")}</span><span className="text-gray-300">Max</span>
                </div>
                {godownAllocs.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm px-1">
                    <span className="w-40 font-medium truncate text-gray-700">{a.godownName}</span>
                    <input type="number" value={a.qty || ""} min={0}
                      onChange={e => { const u = [...godownAllocs]; u[i] = { ...u[i], qty: parseFloat(e.target.value) || 0 }; setGodownAllocs(u); }}
                      className="input-field w-28" />
                    <span className="text-xs text-gray-400">/ {a.maxQty}</span>
                    <button type="button" onClick={() => godownAllToOne(a.godownId)} className="text-xs text-primary-500 hover:underline ml-auto">
                      All here
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })() : <p className="text-sm text-gray-400">{t("no_godowns")}</p>}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleGodownAlloc} disabled={godownSubmitting} className="btn-primary text-sm">{godownSubmitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      <Modal open={showGodownManage} onClose={() => { setShowGodownManage(false); setGodownOpenActionId(null); }} title={t("godowns")} size="md">
        <div className="mb-4 flex items-center justify-end">
          <GlassButton variant="secondary" onClick={openCreateGodown}>
            + {t("new_godown")}
          </GlassButton>
        </div>
        {godownManageLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : godownManageList.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">{t("no_godowns")}</p>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {godownManageList.map((g: any) => (
              <div key={g.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{g.name}</p>
                  <p className="text-xs text-gray-400">{g.cityName}</p>
                </div>
                <span className={g.isActive ? "badge-active" : "badge-cancelled"}>
                  {g.isActive ? t("active") : t("inactive")}
                </span>
                <RowActionMenu
                  open={godownOpenActionId === g.id}
                  onOpenChange={(open) => setGodownOpenActionId(open ? g.id : null)}
                >
                  {!isSeedGodownName(g.name) && (
                    <button
                      onClick={() => { setGodownOpenActionId(null); openEditGodown(g); }}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs"
                    >
                      {t("edit")}
                    </button>
                  )}
                  {g.isActive && (
                    <button
                      type="button"
                      onClick={() => { setGodownOpenActionId(null); void handleDeactivateGodown(g); }}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs"
                    >
                      {t("deactivate")}
                    </button>
                  )}
                </RowActionMenu>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={showEditGodown} onClose={() => setShowEditGodown(false)} title={`${t("edit")}: ${selectedGodown?.name || ""}`} size="md">
        {editGodownError && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{editGodownError}</div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t("godown_name")} *</label>
          <input
            value={editGodownForm.name}
            onChange={(e) => setEditGodownForm({ name: e.target.value })}
            className="input-field"
            autoFocus
          />
        </div>
        <div className="mt-4 flex justify-end border-t pt-4">
          <GlassButton variant="primary" onClick={() => { void handleEditGodown(); }} disabled={editGodownSubmitting}>
            {editGodownSubmitting ? "..." : t("save")}
          </GlassButton>
        </div>
      </Modal>

      <Modal open={showNewGoods} onClose={() => setShowNewGoods(false)} title="New Goods" size="lg">
        <p className="mb-4 text-xs text-gray-500">Incoming stock assigned to your city — allocate across godowns.</p>
        {lotsLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : !lotAssignmentRows.length ? (
          <p className="py-6 text-center text-sm text-gray-400">{t("no_data")}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">New Assignments</h3>
              {newAssignmentRows.length === 0 ? (
                <p className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-400">No new assignments waiting.</p>
              ) : (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {newAssignmentRows.map(({ lot, dist, assigned, remaining, isDone }, i) => (
                    <div key={`new-${i}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800">{dist.productName}</span>
                          <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-600">{lot.lotNumber}</span>
                          {isDone
                            ? <span className="rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">✓ Fully assigned</span>
                            : <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{formatNumber(remaining)} unassigned</span>
                          }
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">
                          Allocated: <strong className="text-gray-600">{formatNumber(Number(dist.allocatedQty))}</strong>
                          {" · "}Assigned: <strong className="text-gray-600">{formatNumber(assigned)}</strong>
                        </p>
                      </div>
                      <button
                        onClick={() => openGodownAlloc(lot, dist)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100"
                      >
                        <Warehouse size={13} /> Assign
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAssignedRows((v) => !v)}
                className="text-sm font-semibold text-gray-700 hover:text-primary-700"
              >
                {showAssignedRows ? "Hide Assigned / Reassignment" : "Show Assigned / Reassignment"}
              </button>
              {showAssignedRows && (
                <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {existingAssignmentRows.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">No prior assignments yet.</p>
                  ) : existingAssignmentRows.map(({ lot, dist, assigned, remaining, isDone }, i) => (
                    <div key={`existing-${i}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800">{dist.productName}</span>
                          <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-600">{lot.lotNumber}</span>
                          {isDone
                            ? <span className="rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">✓ Fully assigned</span>
                            : <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{formatNumber(remaining)} unassigned</span>
                          }
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">
                          Allocated: <strong className="text-gray-600">{formatNumber(Number(dist.allocatedQty))}</strong>
                          {" · "}Assigned: <strong className="text-gray-600">{formatNumber(assigned)}</strong>
                        </p>
                      </div>
                      <button
                        onClick={() => openGodownAlloc(lot, dist)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100"
                      >
                        <Warehouse size={13} /> Re-assign
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showCreateGodown} onClose={() => setShowCreateGodown(false)} title={t("new_godown")} size="md">
        {createGodownError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{createGodownError}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("godown_name")} *</label>
          <input
            value={createGodownForm.name}
            onChange={(e) => setCreateGodownForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field"
            placeholder={t("godown_name")}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <GlassButton variant="primary" onClick={() => { void handleCreateGodown(); }} disabled={createGodownSubmitting}>
            {createGodownSubmitting ? "..." : t("save")}
          </GlassButton>
        </div>
      </Modal>
    </div>
  );
}
