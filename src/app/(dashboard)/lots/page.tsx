"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatsCard, StatusBadge, formatNumber, formatDate, RowActionMenu } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { Pencil, Package, CheckCircle, RotateCcw, Trash2, Warehouse } from "lucide-react";
import { exportLotCostLedgerXlsx, exportLotCostLedgerPdf } from "@/lib/ledger-export";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingLots } from "@/lib/offline-queue-overlays";
import { LotDetailSummary, LotDetailLedger, CityLotAssignmentDetail } from "@/components/lots/LotDetailTabs";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { applyQueuedMutationsToLots } from "@/lib/offline-remaining-mutations";
import { formatCityPot } from "@/lib/city-money-format";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";

const LOTS_READ_CACHE_KEY = "mrf-lots-read-cache-v1";

type LotsReadSnapshot = {
  lots: any[];
  totalPages: number;
  total: number;
  countries: any[];
  products: any[];
  suppliers: any[];
  lotDetailById: Record<string, any>;
};

type LotDetailTab = "summary" | "ledger";

export default function LotsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const deepLinkHandled = useRef(false);
  const { isOnline, queuedItems, discardQueuedItem } = useOffline();
  const [lots,       setLots]       = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total,      setTotal]      = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  // Create
  const [showCreate,  setShowCreate]  = useState(false);
  const [countries,   setCountries]   = useState<any[]>([]);
  const [products,    setProducts]    = useState<any[]>([]);
  const [suppliers,   setSuppliers]   = useState<any[]>([]);

  const emptyItem = () => ({ supplierId: 0, productId: 0, weightPerCartonKg: "", qtyMt: "", unitPriceUsdPerMt: "" });
  const [createForm, setCreateForm] = useState({
    countryId: 0, lotNumber: "", lotDate: new Date().toISOString().split("T")[0], notes: "",
    purchaseItems: [emptyItem()] as any[],
  });

  // Detail
  const [showDetail,    setShowDetail]    = useState(false);
  const [selectedLot,   setSelectedLot]   = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<LotDetailTab>("summary");

  // Distribute
  const [showDistribute,    setShowDistribute]    = useState(false);
  const [distributions,     setDistributions]     = useState<any[]>([]);
  const [cities,            setCities]            = useState<any[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [enabledCityIds,    setEnabledCityIds]    = useState<Set<number>>(new Set()); // city toggle filter

  // Godown alloc
  const [showGodownAlloc, setShowGodownAlloc] = useState(false);
  const [godownAllocs,    setGodownAllocs]    = useState<any[]>([]);
  const [selectedDist,    setSelectedDist]    = useState<any>(null);

  // Edit lot
  const [showEditLot,  setShowEditLot]  = useState(false);
  const [editLotData,  setEditLotData]  = useState<any>(null);
  const [editProducts, setEditProducts] = useState<any[]>([]);
  const [editWarnings, setEditWarnings] = useState<string[]>([]); // cascade warnings

  // PKR rate + add cost
  const [pkrRateInput,  setPkrRateInput]  = useState("");
  const [pkrRateSaving, setPkrRateSaving] = useState(false);
  const [showAddCost,   setShowAddCost]   = useState(false);
  const [costForm,      setCostForm]      = useState({ costType: "freight", description: "", amount: "", currencyCode: "USD", exchangeRate: "", costDate: new Date().toISOString().split("T")[0], notes: "" });
  const [shippingLines,   setShippingLines]   = useState<any[]>([]);
  const [bankAccounts,    setBankAccounts]    = useState<any[]>([]);
  const [intermediaries,  setIntermediaries]  = useState<any[]>([]);
  const [costChargedTo,   setCostChargedTo]   = useState<"shipping_line" | "bank" | "intermediary" | "supplier" | "clearing_agent" | "custom_agent">("bank");
  const [costClearingAgentId, setCostClearingAgentId] = useState<number>(0);
  const [costCustomAgentId, setCostCustomAgentId] = useState<number>(0);
  const [costSupplierId, setCostSupplierId] = useState<number>(0);
  const [costShippingLineId, setCostShippingLineId] = useState<number>(0);
  const [costBankAccountId, setCostBankAccountId] = useState<number>(0);
  const [costIntermediaryId, setCostIntermediaryId] = useState<number>(0);
  const [agents,          setAgents]          = useState<any[]>([]);

  // Edit purchase item
  const [editPurchaseItem, setEditPurchaseItem] = useState<any>(null);
  const [showEditPurchase, setShowEditPurchase] = useState(false);
  const [editPurchaseForm, setEditPurchaseForm] = useState({ qtyMt: "", unitPriceUsdPerMt: "", weightPerCartonKg: "" });

  // Common
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const selectedLotCountryCode = String(selectedLot?.country?.code || selectedLot?.countryCode || "").toUpperCase();
  const isAfgLot = selectedLotCountryCode === "AFG";
  const costNeedsRate = (cc: string) => ["USD", "CNY", "AFN"].includes(String(cc || "").toUpperCase());
  const getPendingQueueId = (id: unknown) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  };

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<LotsReadSnapshot>(LOTS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<LotsReadSnapshot>) => {
    const existing = readSnapshot()?.data || {
      lots: [],
      totalPages: 1,
      total: 0,
      countries: [],
      products: [],
      suppliers: [],
      lotDetailById: {},
    };
    writeOfflineReadSnapshot<LotsReadSnapshot>(LOTS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      lotDetailById: { ...(existing.lotDetailById || {}), ...(partial.lotDetailById || {}) },
    });
  }, [readSnapshot]);


  const loadLots = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/lots", { params });
    if (r.success) {
      let nextRows = [...getPendingLots(queuedItems as any), ...((r.data as any[]) || [])];
      nextRows = applyQueuedMutationsToLots(nextRows, queuedItems as any[]);
      setLots(nextRows);
      const nextTotalPages = (r.pagination as any)?.totalPages || 1;
      const nextTotal = (r.pagination as any)?.total || 0;
      setTotalPages(nextTotalPages);
      setTotal(nextTotal);
      mergeSnapshot({
        lots: nextRows,
        totalPages: nextTotalPages,
        total: nextTotal,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.lots) {
        let cleanedLots = pruneStalePendingRows(snapshot.lots as any[], queuedItems as any[], "/lots");
        cleanedLots = applyQueuedMutationsToLots(cleanedLots, queuedItems as any[]);
        setLots(cleanedLots);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || cleanedLots.length || 0);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, page, queuedItems, readSnapshot, searchQuery]);
  useEffect(() => { loadLots(); }, [loadLots]);
  useEffect(() => { setPage(1); }, [searchQuery]);

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

  // ════════════════════════════════════════════
  // CREATE
  // ════════════════════════════════════════════
  const openCreate = async () => {
    const [cRes, pRes, sRes] = await Promise.all([
      apiCall("/api/v1/countries"),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
      apiCall("/api/v1/suppliers", { params: { limit: 100 } }),
    ]);
    if (cRes.success) {
      setCountries(cRes.data as any[]);
      mergeSnapshot({ countries: cRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.countries?.length) {
        setCountries(snapshot.countries);
        setShowOfflineSnapshot(true);
      }
    }
    if (pRes.success) {
      setProducts(pRes.data as any[]);
      mergeSnapshot({ products: pRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.products?.length) {
        setProducts(snapshot.products);
        setShowOfflineSnapshot(true);
      }
    }
    if (sRes.success) {
      setSuppliers(sRes.data as any[]);
      mergeSnapshot({ suppliers: sRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.suppliers?.length) {
        setSuppliers(snapshot.suppliers);
        setShowOfflineSnapshot(true);
      }
    }
    setCreateForm({ countryId: 0, lotNumber: "", lotDate: new Date().toISOString().split("T")[0], notes: "", purchaseItems: [emptyItem()] });
    setShowCreate(true); setFormError("");
  };

  // Copy purchase items from a previous lot
  const copyFromLot = async (sourceLotId: number) => {
    const r = await apiCall(`/api/v1/lots/${sourceLotId}`);
    if (!r.success || !(r.data as any)?.purchaseItems?.length) return;
    const items = (r.data as any).purchaseItems.map((p: any) => ({
      supplierId: p.supplierId,
      productId:  p.productId,
      weightPerCartonKg: p.weightPerCartonKg ?? "",
      qtyMt: p.qtyMt,
      unitPriceUsdPerMt: p.unitPriceUsdPerMt,
    }));
    setCreateForm(f => ({ ...f, purchaseItems: items }));
  };

  const handleCreate = async () => {
    const validItems = createForm.purchaseItems.filter(
      (p: any) => p.supplierId > 0 && p.productId > 0 && Number(p.weightPerCartonKg) > 0 && Number(p.qtyMt) > 0 && Number(p.unitPriceUsdPerMt) > 0
    );
    if (!createForm.countryId || !createForm.lotNumber || !validItems.length) {
      setFormError("Fill country, lot number and at least one complete invoice line"); return;
    }
    setSubmitting(true);
    const body = {
      countryId:     createForm.countryId,
      lotNumber:     createForm.lotNumber,
      lotDate:       createForm.lotDate,
      notes:         createForm.notes,
      purchaseItems: validItems.map((p: any) => ({
        supplierId:        Number(p.supplierId),
        productId:         Number(p.productId),
        weightPerCartonKg: Number(p.weightPerCartonKg),
        qtyMt:             Number(p.qtyMt),
        unitPriceUsdPerMt: Number(p.unitPriceUsdPerMt),
      })),
      distributions: [],
    };
    const r = await apiCall("/api/v1/lots", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ════════════════════════════════════════════
  // DETAIL
  // ════════════════════════════════════════════
  const openDetail = async (lot: any) => {
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    setSelectedLot(lot); setShowDetail(true); setDetailLoading(true); setFormError("");
    setActiveDetailTab("summary");
    // Pre-fetch shipping lines for super admin cost form
    if (user?.role === "super_admin") {
      if (!shippingLines.length) apiCall("/api/v1/shipping-lines").then(r => { if (r.success) setShippingLines(r.data as any[]); });
      if (!agents.length) apiCall("/api/v1/agents", { params: { limit: 100 } }).then(r => { if (r.success) setAgents(r.data as any[]); });
      if (!suppliers.length) apiCall("/api/v1/suppliers", { params: { limit: 100 } }).then(r => { if (r.success) setSuppliers(r.data as any[]); });
      if (!bankAccounts.length) apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }).then(r => { if (r.success) setBankAccounts(r.data as any[]); });
      if (!intermediaries.length) apiCall("/api/v1/intermediaries").then(r => { if (r.success) setIntermediaries(r.data as any[]); });
    }
    const r = await apiCall(`/api/v1/lots/${lot.id}`);
    if (r.success) {
      const d = r.data as any;
      setSelectedLot(d);
      setPkrRateInput(d.pkrExchangeRate ? String(d.pkrExchangeRate) : "");
      mergeSnapshot({ lotDetailById: { [String(lot.id)]: d } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cachedDetail = snapshot?.lotDetailById?.[String(lot.id)];
      if (cachedDetail) {
        setSelectedLot(cachedDetail);
        setPkrRateInput(cachedDetail.pkrExchangeRate ? String(cachedDetail.pkrExchangeRate) : "");
        setShowOfflineSnapshot(true);
      }
    } else { setFormError(r.error || "Failed to load"); }
    setDetailLoading(false);
  };

  useEffect(() => {
    if (deepLinkHandled.current || loading) return;
    const lotId = Number(searchParams.get("lotId") || 0);
    if (!Number.isInteger(lotId) || lotId <= 0) return;
    deepLinkHandled.current = true;
    const fromList = lots.find((l) => Number(l.id) === lotId);
    void openDetail(fromList || { id: lotId, lotNumber: `Lot #${lotId}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lots, searchParams]);

  const exportLotXlsx = () => {
    if (!selectedLot?.id) return;
    exportLotCostLedgerXlsx({
      lotNumber: String(selectedLot.lotNumber || selectedLot.id),
      lotDate: selectedLot.lotDate,
      countryName: selectedLot.country?.name,
      rows: selectedLot.costLedger || [],
      totalLandedCostPkr: selectedLot.costSummary?.totalLandedCostPkr,
    });
  };

  const exportLotPdf = () => {
    if (!selectedLot?.id) return;
    exportLotCostLedgerPdf({
      lotNumber: String(selectedLot.lotNumber || selectedLot.id),
      lotDate: selectedLot.lotDate,
      countryName: selectedLot.country?.name,
      rows: selectedLot.costLedger || [],
      totalLandedCostPkr: selectedLot.costSummary?.totalLandedCostPkr,
    });
  };

  const savePkrRate = async () => {
    if (!pkrRateInput || Number(pkrRateInput) <= 0) return;
    setPkrRateSaving(true);
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/pkr-rate`, { method: "PUT", body: { pkrExchangeRate: Number(pkrRateInput) } });
    setPkrRateSaving(false);
    if (r.success) setSelectedLot((prev: any) => ({ ...prev, pkrExchangeRate: Number(pkrRateInput) }));
  };

  const openAddCost = () => {
    setCostForm({
      costType: "freight",
      description: "",
      amount: "",
      currencyCode: "USD",
      exchangeRate: "",
      costDate: new Date().toISOString().split("T")[0],
      notes: "",
    });
    setFormError("");
    setCostChargedTo("shipping_line");
    setCostSupplierId(0);
    setCostClearingAgentId(0);
    setCostCustomAgentId(0);
    setCostShippingLineId(0);
    setCostBankAccountId(0);
    setCostIntermediaryId(0);
    setShowAddCost(true);
  };

  const handleAddCost = async () => {
    if (!costForm.description || !costForm.amount || Number(costForm.amount) <= 0) { setFormError("Description and amount required"); return; }
    const isFreight = costForm.costType === "freight";
    const currencyCode = String(costForm.currencyCode || (isFreight ? "USD" : isAfgLot ? "AFN" : "PKR")).toUpperCase();
    if (isFreight && costShippingLineId <= 0) {
      setFormError("Shipping line is required for freight cost");
      return;
    }
    if (!isFreight) {
      if (costChargedTo === "supplier" && costSupplierId <= 0) {
        setFormError("Please select a supplier");
        return;
      }
      if (costChargedTo === "clearing_agent" && costClearingAgentId <= 0) {
        setFormError("Please select a clearing agent");
        return;
      }
      if (costChargedTo === "custom_agent" && costCustomAgentId <= 0) {
        setFormError("Please select a custom agent");
        return;
      }
      if (costChargedTo === "bank" && costBankAccountId <= 0) {
        setFormError("Please select a bank account");
        return;
      }
      if (costChargedTo === "intermediary" && costIntermediaryId <= 0) {
        setFormError("Please select an intermediary");
        return;
      }
    }
    if (costNeedsRate(currencyCode) && Number(costForm.exchangeRate) <= 0) {
      setFormError(`Acquisition rate (${currencyCode}→PKR) is required`);
      return;
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      lotId:            selectedLot.id,
      costType:         costForm.costType,
      description:      costForm.description,
      amount:           Number(costForm.amount),
      currencyCode,
      costDate:         costForm.costDate,
      supplierId:       costChargedTo === "supplier" && costSupplierId > 0 ? costSupplierId : null,
      agentId:          costChargedTo === "clearing_agent"
        ? (costClearingAgentId > 0 ? costClearingAgentId : null)
        : costChargedTo === "custom_agent"
        ? (costCustomAgentId > 0 ? costCustomAgentId : null)
        : null,
      shippingLineId:   costChargedTo === "shipping_line" && costShippingLineId > 0 ? costShippingLineId : null,
      paidFromCash:     false,
      superAdminBankAccountId: costChargedTo === "bank" ? costBankAccountId : null,
      bankAccountId:    null,
      intermediaryId:   costChargedTo === "intermediary" ? costIntermediaryId : null,
    };
    if (costNeedsRate(currencyCode)) body.exchangeRate = Number(costForm.exchangeRate);
    if (costForm.notes?.trim()) body.notes = costForm.notes.trim();
    const r = await apiCall("/api/v1/lot-costs", { method: "POST", body });
    setSubmitting(false);
    if (r.success) {
      setShowAddCost(false);
      // Refresh detail
      const dr = await apiCall(`/api/v1/lots/${selectedLot.id}`);
      if (dr.success) setSelectedLot(dr.data);
    } else { setFormError(r.error || "Failed"); }
  };

  const openEditPurchase = (item: any) => {
    setEditPurchaseItem(item);
    setEditPurchaseForm({ qtyMt: String(item.qtyMt), unitPriceUsdPerMt: String(item.unitPriceUsdPerMt), weightPerCartonKg: String(item.weightPerCartonKg ?? "") });
    setFormError(""); setShowEditPurchase(true);
  };

  const handleEditPurchase = async () => {
    if (!editPurchaseItem) return;
    if (Number(editPurchaseForm.qtyMt) <= 0 || Number(editPurchaseForm.unitPriceUsdPerMt) <= 0) { setFormError("Qty and price must be greater than 0"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/lot-purchases/${editPurchaseItem.id}`, {
      method: "PUT",
      body: {
        qtyMt:             Number(editPurchaseForm.qtyMt),
        unitPriceUsdPerMt: Number(editPurchaseForm.unitPriceUsdPerMt),
        weightPerCartonKg: Number(editPurchaseForm.weightPerCartonKg) > 0 ? Number(editPurchaseForm.weightPerCartonKg) : undefined,
      },
    });
    setSubmitting(false);
    if (r.success) {
      setShowEditPurchase(false);
      const dr = await apiCall(`/api/v1/lots/${selectedLot.id}`);
      if (dr.success) setSelectedLot(dr.data);
    } else { setFormError(r.error || "Failed"); }
  };

  const handleDeletePurchase = async (item: any) => {
    if (!confirm(`Delete purchase item: ${item.supplierName} – ${item.productName}? This cannot be undone.`)) return;
    const r = await apiCall(`/api/v1/lot-purchases/${item.id}`, { method: "DELETE" });
    if (r.success) {
      const dr = await apiCall(`/api/v1/lots/${selectedLot.id}`);
      if (dr.success) setSelectedLot(dr.data);
    } else { alert(r.error || "Failed"); }
  };

  // ════════════════════════════════════════════
  // DISTRIBUTE
  // ════════════════════════════════════════════
  const openDistribute = async (lot: any) => {
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    setSelectedLot(lot); setDistributions([]); setShowDistribute(true); setFormError(""); setDetailLoading(true);
    try {
      const [detailRes, cityRes] = await Promise.all([
        apiCall(`/api/v1/lots/${lot.id}`),
        apiCall("/api/v1/cities", { params: { all: "true" } }),
      ]);
      if (!detailRes.success) { setFormError("Failed to load: " + (detailRes.error || "")); setDetailLoading(false); return; }
      const ld = detailRes.data as any;
      setSelectedLot(ld);
      const allCities = (cityRes.data || []) as any[];
      const cc = allCities.filter((c: any) => c.countryId === ld.country?.id);
      if (!cc.length) { setFormError(`No cities for country ${ld.country?.name}`); setDetailLoading(false); return; }
      setCities(cc);
      const prods = ld.products || [];
      if (!prods.length) { setFormError("No products in this lot. Edit lot first to add products."); setDetailLoading(false); return; }

      // Build flat distribution rows, pre-filling existing allocations
      const dists: any[] = [];
      for (const city of cc) {
        for (const prod of prods) {
          const ex = ld.distributions?.find((d: any) => d.cityId === city.id && d.productId === prod.productId);
          dists.push({ cityId: city.id, cityName: city.name, productId: prod.productId, productName: prod.productName, allocatedQty: ex?.allocatedQty || 0, maxQty: prod.totalQty });
        }
      }
      setDistributions(dists);

      // Enable all cities that already have any allocation, else enable all
      const citiesWithAllocs = new Set<number>(ld.distributions?.map((d: any) => d.cityId) || []);
      setEnabledCityIds(citiesWithAllocs.size > 0 ? citiesWithAllocs : new Set(cc.map((c: any) => c.id)));

      if (prods.length > 0) setExpandedProductId(prods[0].productId);
    } catch (e) { setFormError("Error loading"); }
    setDetailLoading(false);
  };

  // Even split for a product across enabled cities
  const evenSplit = (productId: number) => {
    const enabledCities = cities.filter(c => enabledCityIds.has(c.id));
    if (!enabledCities.length) return;
    const group = distributions.find(d => d.productId === productId);
    if (!group) return;
    const perCity = Math.floor(group.maxQty / enabledCities.length);
    const remainder = group.maxQty - perCity * enabledCities.length;
    setDistributions(prev => prev.map((d, idx) => {
      if (d.productId !== productId) return d;
      if (!enabledCityIds.has(d.cityId)) return { ...d, allocatedQty: 0 };
      const cityIndex = enabledCities.findIndex(c => c.id === d.cityId);
      // Give the remainder to the first city
      return { ...d, allocatedQty: perCity + (cityIndex === 0 ? remainder : 0) };
    }));
  };

  // Assign all remaining qty to one city
  const allToCity = (productId: number, cityId: number) => {
    const group = distributions.filter(d => d.productId === productId);
    const max = group[0]?.maxQty || 0;
    setDistributions(prev => prev.map(d => {
      if (d.productId !== productId) return d;
      return { ...d, allocatedQty: d.cityId === cityId ? max : 0 };
    }));
  };

  const handleDistribute = async () => {
    setSubmitting(true); setFormError("");
    // Only include enabled cities
    const validDists = distributions
      .filter(d => d.allocatedQty > 0 && enabledCityIds.has(d.cityId))
      .map(({ cityId, productId, allocatedQty }: any) => ({ cityId, productId, allocatedQty }));
    if (!validDists.length) { setFormError("Enter at least one allocation"); setSubmitting(false); return; }
    for (const prod of (selectedLot.products || [])) {
      const totalDist = distributions
        .filter((d: any) => d.productId === prod.productId && enabledCityIds.has(d.cityId))
        .reduce((s: number, d: any) => s + (d.allocatedQty || 0), 0);
      if (totalDist > prod.totalQty) {
        setFormError(`${prod.productName}: distributed ${totalDist} > total ${prod.totalQty}`);
        setSubmitting(false); return;
      }
    }
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/distribute`, { method: "PUT", body: { distributions: validDists } });
    setSubmitting(false);
    if (r.success) { setShowDistribute(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ════════════════════════════════════════════
  // GODOWN ALLOCATION
  // ════════════════════════════════════════════
  const openGodownAlloc = async (lot: any, dist: any) => {
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    setSelectedDist(dist); setSelectedLot(lot); setFormError("");
    const gRes = await apiCall("/api/v1/godowns", { params: { city_id: dist.cityId, limit: 50 } });
    const godowns = ((gRes.data || []) as any[]).filter((g: any) => g.isActive);
    const allocs: any[] = [];
    for (const gd of godowns) {
      const ex = dist.godownAllocations?.find((ga: any) => ga.godownId === gd.id);
      allocs.push({ productId: dist.productId, productName: dist.productName, godownId: gd.id, godownName: gd.name, qty: ex?.qty || 0, maxQty: Number(dist.allocatedQty) });
    }
    setGodownAllocs(allocs); setShowGodownAlloc(true);
  };

  // Even split across godowns
  const godownEvenSplit = () => {
    if (!godownAllocs.length) return;
    const max = godownAllocs[0]?.maxQty || 0;
    const perGodown = Math.floor(max / godownAllocs.length);
    const remainder = max - perGodown * godownAllocs.length;
    setGodownAllocs(prev => prev.map((a, i) => ({ ...a, qty: perGodown + (i === 0 ? remainder : 0) })));
  };

  // All to one godown
  const godownAllToOne = (godownId: number) => {
    const max = godownAllocs[0]?.maxQty || 0;
    setGodownAllocs(prev => prev.map(a => ({ ...a, qty: a.godownId === godownId ? max : 0 })));
  };

  const handleGodownAlloc = async () => {
    setSubmitting(true); setFormError("");
    const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
    const maxQty = godownAllocs[0]?.maxQty || 0;
    if (totalAlloc > maxQty) { setFormError(`Total ${totalAlloc} exceeds allocated qty ${maxQty}`); setSubmitting(false); return; }
    const validAllocs = godownAllocs.filter(a => a.qty > 0).map(({ godownId, qty }: any) => ({ godownId, qty }));
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/godown-allocation`, {
      method: "POST",
      body: { cityId: selectedDist.cityId, productId: selectedDist.productId, allocations: validAllocs },
    });
    setSubmitting(false);
    if (r.success) { setShowGodownAlloc(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ════════════════════════════════════════════
  // EDIT LOT
  // ════════════════════════════════════════════
  const openEditLot = async (lot: any) => {
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    if (!products.length) {
      const pRes = await apiCall("/api/v1/products", { params: { limit: 100 } });
      if (pRes.success) setProducts(pRes.data as any[]);
    }
    const r = await apiCall(`/api/v1/lots/${lot.id}`);
    if (!r.success) { alert("Failed to load lot"); return; }
    const d = r.data as any;
    setEditLotData(d);
    setEditProducts(d.products?.length ? d.products.map((p: any) => ({ productId: p.productId, totalQty: p.totalQty })) : [{ productId: 0, totalQty: 0 }]);
    setEditWarnings([]);
    setShowEditLot(true); setFormError("");
  };

  const handleEditLot = async () => {
    const validP = editProducts.filter(p => p.productId > 0 && p.totalQty > 0);
    if (!validP.length) { setFormError("Add at least one product"); return; }
    setSubmitting(true); setEditWarnings([]);
    const r = await apiCall(`/api/v1/lots/${editLotData.id}`, {
      method: "PUT",
      body: { lotNumber: editLotData.lotNumber, notes: editLotData.notes, products: validP },
    });
    setSubmitting(false);
    if (r.success) {
      const warnings = (r.data as any)?.warnings || [];
      if (warnings.length > 0) {
        setEditWarnings(warnings); // show cascade warnings without closing
      } else {
        setShowEditLot(false); loadLots();
      }
    } else { setFormError(r.error || "Failed"); }
  };

  // ════════════════════════════════════════════
  // DELETE / COMPLETE / REOPEN
  // ════════════════════════════════════════════
  const handleDeleteLot = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_delete")} ${t("cannot_undo")}`)) return;
    const pendingQueueId = getPendingQueueId(lot?.id);
    if (pendingQueueId) {
      const ok = await discardQueuedItem(pendingQueueId);
      if (!ok) return;
      setLots((prev) => {
        const next = prev.filter((row) => row.id !== lot.id);
        mergeSnapshot({ lots: next, totalPages, total: Math.max(0, total - 1) });
        return next;
      });
      return;
    }
    const r = await apiCall(`/api/v1/lots/${lot.id}`, { method: "DELETE" });
    if (r.success) loadLots(); else alert(r.error || "Failed - lot may have active sales");
  };
  const handleComplete = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_complete")}`)) return;
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    const r = await apiCall(`/api/v1/lots/${lot.id}/complete`, { method: "PUT" });
    if (r.success) loadLots(); else alert(r.error || "Failed");
  };
  const handleReopen = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_reopen")}`)) return;
    if (getPendingQueueId(lot?.id)) { alert("Pending lot is not synced yet. Please sync first."); return; }
    const r = await apiCall(`/api/v1/lots/${lot.id}/reopen`, { method: "PUT" });
    if (r.success) loadLots(); else alert(r.error || "Failed");
  };

  // ════════════════════════════════════════════
  // TABLE COLUMNS
  // ════════════════════════════════════════════
  const columns = [
    { key: "lotNumber", label: t("lot_num"), render: (l: any) => (
      getPendingQueueId(l?.id)
        ? <span className="font-mono font-semibold text-gray-500 text-sm">{l.lotNumber}</span>
        : <button onClick={() => openDetail(l)} className="font-mono font-semibold text-primary-600 hover:underline text-sm">{l.lotNumber}</button>
    )},
    ...(user?.role !== "city_admin" ? [{ key: "country", label: t("country"), render: (l: any) => (
      <span className="text-sm text-gray-700">{l.countryName || l.country?.name}</span>
    )}] : []),
    { key: "lotDate",  label: t("date"),     render: (l: any) => <span className="text-sm text-gray-500">{formatDate(l.lotDate)}</span> },
    { key: "products", label: t("product"),  render: (l: any) => {
      const isCityView = user?.role === "city_admin";
      const items = isCityView ? (l.assignmentProducts || l.distributions || []) : (l.products || []);
      const qtyKey = isCityView ? "assignedQty" : "totalQty";
      return (
      <div className="flex flex-wrap gap-1">
        {items.map((p: any) => (
          <span key={p.productId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100 whitespace-nowrap">
            {p.productName} <span className="font-bold text-blue-900">{formatNumber(Number(p[qtyKey] || p.allocatedQty || 0))}</span>
          </span>
        ))}
      </div>
      );
    }},
    { key: "distribution", label: user?.role === "city_admin" ? "Godowns" : t("distribute"), render: (l: any) => {
      if (user?.role === "city_admin") {
        const godownSlots = (l.distributions || []).reduce((s: number, d: any) => s + (d.godownAllocations?.length || 0), 0);
        if (!godownSlots) return <span className="inline-flex items-center px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full text-xs font-medium border border-yellow-100">Not in godowns</span>;
        return <span className="inline-flex items-center px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">{godownSlots} allocation{godownSlots === 1 ? "" : "s"}</span>;
      }
      const count = l.distributions?.length || 0;
      if (!count) return <span className="inline-flex items-center px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full text-xs font-medium border border-yellow-100">{t("no_data")}</span>;
      const cityCount = Array.from(new Set(l.distributions.map((d: any) => d.cityName))).length;
      return <span className="inline-flex items-center px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">{cityCount} {t("cities") || "cities"}</span>;
    }},
    { key: "utilization", label: user?.role === "city_admin" ? t("sold") : "Utilization", render: (l: any) => {
      const total = Number(l.totalCartons || 0);
      const sold = Number(l.soldCartons || 0);
      const pct = total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0;
      const cls = pct >= 90 ? "bg-green-50 text-green-700 border-green-200" : pct >= 60 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-amber-50 text-amber-700 border-amber-200";
      const soldAmountLabel = user?.role === "city_admin" ? formatCityPot(user, l.soldSalesByCurrency) : "";
      return (
        <div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
            {sold}/{total} ({pct}%)
          </span>
          {soldAmountLabel && soldAmountLabel !== "0" && (
            <div className="mt-1 text-xs font-medium text-green-700">{soldAmountLabel}</div>
          )}
        </div>
      );
    }},
    { key: "status",  label: t("status"),  render: (l: any) => <StatusBadge status={l.status} /> },
    {
      key: "actions", label: t("actions"),
      render: (l: any) => (
        <>
          {user?.role === "super_admin" && (
            <RowActionMenu
              open={openActionId === l.id}
              onOpenChange={(open) => setOpenActionId(open ? l.id : null)}
            >
              {!getPendingQueueId(l?.id) && (
                <>
                  <button onClick={() => { setOpenActionId(null); openEditLot(l); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">Edit Lot</button>
                  <button onClick={() => { setOpenActionId(null); openDistribute(l); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-blue-700 hover:bg-blue-50 sm:py-2 sm:text-xs">Distribute</button>
                  {l.status === "ongoing" && (
                    <button onClick={() => { setOpenActionId(null); handleComplete(l); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-green-700 hover:bg-green-50 sm:py-2 sm:text-xs">Complete</button>
                  )}
                  {l.status === "completed" && (
                    <button onClick={() => { setOpenActionId(null); handleReopen(l); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-amber-700 hover:bg-amber-50 sm:py-2 sm:text-xs">Reopen</button>
                  )}
                </>
              )}
              <button onClick={() => { setOpenActionId(null); handleDeleteLot(l); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">Delete</button>
            </RowActionMenu>
          )}
          {user?.role === "city_admin" && (
            <button onClick={() => openDetail(l)} className="text-xs text-primary-600 hover:underline">View</button>
          )}
        </>
      ),
    },
  ];

  const isCityAssignmentView =
    user?.role === "city_admin" || selectedLot?.viewMode === "city_assignment";

  return (
    <div>
      <PageHeader title={t("lots")}
        action={user?.role === "super_admin" ? <button onClick={openCreate} className="btn-primary text-sm">{"+ " + t("new_lot")}</button> : undefined} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}
      <DataTable
        searchPlaceholder="Lot number, product, supplier…"
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        columns={columns}
        data={lots}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      {/* ══════════════════════════════════════
          CREATE LOT — Invoice-style form
      ══════════════════════════════════════ */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_lot")} size="xl">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}

        {/* ── Header row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("date")} *</label>
            <input type="date" value={createForm.lotDate}
              onChange={e => setCreateForm(f => ({ ...f, lotDate: e.target.value }))}
              className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("country")} *</label>
            <select value={createForm.countryId}
              onChange={e => setCreateForm(f => ({ ...f, countryId: parseInt(e.target.value) }))}
              className="select-field">
              <option value={0}>{t("select")}</option>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("lot_num")} *</label>
            <input value={createForm.lotNumber}
              onChange={e => setCreateForm(f => ({ ...f, lotNumber: e.target.value }))}
              className="input-field font-mono" placeholder="e.g. JBP-2026-001" />
          </div>
        </div>

        {/* Copy from previous lot */}
        {lots.length > 0 && (
          <div className="flex items-center gap-2 mb-3 pb-3 border-b">
            <span className="text-xs text-gray-400 shrink-0">Copy items from previous lot:</span>
            <select className="select-field text-xs flex-1" defaultValue=""
              onChange={e => { if (e.target.value) copyFromLot(Number(e.target.value)); }}>
              <option value="">— select —</option>
              {lots.slice(0, 20).map(l => (
                <option key={l.id} value={l.id}>{l.lotNumber} ({l.countryName})</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Invoice items table ── */}
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_90px_90px_110px_100px_32px] gap-0 bg-gray-50 border-b border-gray-200">
            {["Supplier", "Product", "Wt/crt (kg)", "Qty (MT)", "USD/MT", "Amount USD", ""].map((h, i) => (
              <div key={i} className="px-2 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-r last:border-r-0 border-gray-200">
                {h}
              </div>
            ))}
          </div>

          {/* Item rows */}
          {createForm.purchaseItems.map((item: any, i: number) => {
            const amt = Number(item.qtyMt) > 0 && Number(item.unitPriceUsdPerMt) > 0
              ? Math.round(Number(item.qtyMt) * Number(item.unitPriceUsdPerMt) * 100) / 100
              : 0;
            const updateItem = (field: string, val: any) => {
              const u = [...createForm.purchaseItems]; u[i] = { ...u[i], [field]: val };
              setCreateForm(f => ({ ...f, purchaseItems: u }));
            };
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_90px_110px_100px_32px] gap-0 border-b last:border-b-0 border-gray-100 hover:bg-blue-50/30 transition-colors">
                {/* Supplier */}
                <div className="px-2 py-1.5 border-r border-gray-100">
                  <select value={item.supplierId} onChange={e => updateItem("supplierId", parseInt(e.target.value))}
                    className="w-full text-sm border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-primary-400 rounded px-1">
                    <option value={0}>Select</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {/* Product */}
                <div className="px-2 py-1.5 border-r border-gray-100">
                  <select value={item.productId} onChange={e => updateItem("productId", parseInt(e.target.value))}
                    className="w-full text-sm border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-primary-400 rounded px-1">
                    <option value={0}>Select</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {/* Weight/crt */}
                <div className="px-2 py-1.5 border-r border-gray-100">
                  <input type="number" value={item.weightPerCartonKg} placeholder="20"
                    onChange={e => updateItem("weightPerCartonKg", e.target.value)}
                    className="w-full text-sm border-0 bg-transparent focus:outline-none text-right" min="0.001" step="0.001" />
                </div>
                {/* Qty MT */}
                <div className="px-2 py-1.5 border-r border-gray-100">
                  <input type="number" value={item.qtyMt} placeholder="0.00"
                    onChange={e => updateItem("qtyMt", e.target.value)}
                    className="w-full text-sm border-0 bg-transparent focus:outline-none text-right" min="0.001" step="0.001" />
                </div>
                {/* Unit price USD/MT */}
                <div className="px-2 py-1.5 border-r border-gray-100">
                  <input type="number" value={item.unitPriceUsdPerMt} placeholder="0.00"
                    onChange={e => updateItem("unitPriceUsdPerMt", e.target.value)}
                    className="w-full text-sm border-0 bg-transparent focus:outline-none text-right" min="0.01" step="0.01" />
                </div>
                {/* Amount (auto) */}
                <div className="px-2 py-1.5 border-r border-gray-100 flex items-center justify-end">
                  <span className="text-sm font-medium text-gray-700">
                    {amt > 0 ? `$${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                  </span>
                </div>
                {/* Remove */}
                <div className="px-1 py-1.5 flex items-center justify-center">
                  {createForm.purchaseItems.length > 1 && (
                    <button onClick={() => setCreateForm(f => ({ ...f, purchaseItems: f.purchaseItems.filter((_: any, idx: number) => idx !== i) }))}
                      className="text-gray-300 hover:text-red-500 text-lg leading-none transition-colors">×</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add item */}
        <button
          onClick={() => setCreateForm(f => ({ ...f, purchaseItems: [...f.purchaseItems, emptyItem()] }))}
          className="text-primary-600 text-sm hover:underline mb-4">
          + {t("add_item")}
        </button>

        {/* Notes + Total row */}
        <div className="grid grid-cols-2 gap-4 mb-1">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("notes")}</label>
            <textarea value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
              className="input-field" rows={2} placeholder="Optional notes…" />
          </div>
          <div className="flex flex-col items-end justify-end gap-1 pb-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Total Amount (USD)</span>
            <span className="text-2xl font-bold text-gray-800">
              ${createForm.purchaseItems.reduce((s: number, p: any) => {
                const amt = Number(p.qtyMt) * Number(p.unitPriceUsdPerMt);
                return s + (isNaN(amt) ? 0 : amt);
              }, 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-gray-400">
              {createForm.purchaseItems.reduce((s: number, p: any) => {
                const wt = Number(p.weightPerCartonKg);
                const mt = Number(p.qtyMt);
                return s + (wt > 0 && mt > 0 ? Math.round((mt * 1000) / wt) : 0);
              }, 0).toLocaleString("en-US")} cartons (calculated)
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 mt-2 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">
            {submitting ? "Creating…" : t("create")}
          </button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════
          LOT DETAIL
      ══════════════════════════════════════ */}
      <Modal open={showDetail} onClose={() => setShowDetail(false)} title={`${t("lot")}: ${selectedLot?.lotNumber || ""}`} size="xl">
        {detailLoading
          ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-gray-400">{t("loading")}</p></div>
          : selectedLot?.id ? (
          isCityAssignmentView ? (
            <CityLotAssignmentDetail selectedLot={selectedLot} t={t} />
          ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#e9dccb] bg-[linear-gradient(135deg,rgba(255,248,239,0.95),rgba(245,233,219,0.84))] p-4 shadow-[0_22px_50px_-42px_rgba(51,42,33,0.38)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f7963]">Lot Snapshot</p>
                <div className="flex items-center gap-2">
                  <button onClick={exportLotXlsx} className="glass-btn glass-btn-xlsx px-3 py-1.5">
                    Export XLSX
                  </button>
                  <button onClick={exportLotPdf} className="glass-btn glass-btn-pdf px-3 py-1.5">
                    Export PDF
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("lot")}</p>
                  <p className="mt-1 text-sm font-semibold text-[#2f241b]">{selectedLot.lotNumber}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("date")}</p>
                  <p className="mt-1 text-sm font-semibold text-[#2f241b]">{formatDate(selectedLot.lotDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("country")}</p>
                  <p className="mt-1 text-sm font-semibold text-[#2f241b]">{selectedLot.country?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("status")}</p>
                  <div className="mt-1"><StatusBadge status={selectedLot.status} /></div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">Created By</p>
                  <p className="mt-1 text-sm font-semibold text-[#2f241b]">{selectedLot.createdBy?.fullName || "—"}</p>
                </div>
              </div>
              {selectedLot.notes && (
                <div className="mt-3 rounded-xl border border-[#eadccb] bg-white/70 px-3 py-2 text-xs text-[#6f5f50]">
                  <span className="font-semibold text-[#5f4e3e]">{t("notes")}:</span> {selectedLot.notes}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-b border-[#eadfce] pb-3">
              {([
                { key: "summary", label: "Summary" },
                { key: "ledger", label: "Cost Ledger" },
              ] as { key: LotDetailTab; label: string }[]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveDetailTab(tab.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeDetailTab === tab.key
                      ? "bg-[#5d4a3a] text-white"
                      : "border border-[#dccfbe] bg-white text-[#695544] hover:bg-[#fbf4ea]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeDetailTab === "summary" && (
              <LotDetailSummary
                selectedLot={selectedLot}
                userRole={user?.role}
                t={t}
                onAddCost={openAddCost}
                onEditPurchase={openEditPurchase}
                onDeletePurchase={handleDeletePurchase}
              />
            )}

            {activeDetailTab === "ledger" && (
              <LotDetailLedger selectedLot={selectedLot} userRole={user?.role} />
            )}

          </div>
          )
        ) : <p className="text-gray-400 py-4">{formError || t("no_data")}</p>}
      </Modal>


      {/* ══════════════════════════════════════
          ADD COST
      ══════════════════════════════════════ */}
      <Modal open={showAddCost} onClose={() => setShowAddCost(false)} title={`Add Cost — ${selectedLot?.lotNumber || ""}`} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Type *</label>
              <select value={costForm.costType} onChange={e => {
                const type = e.target.value;
                const isFreight = type === "freight";
                const defaultCurrency = isFreight ? "USD" : (isAfgLot ? "AFN" : "PKR");
                setCostForm(f => ({
                  ...f,
                  costType: type,
                  currencyCode: defaultCurrency,
                  exchangeRate: costNeedsRate(defaultCurrency) ? f.exchangeRate : "",
                }));
                setCostChargedTo(
                  isFreight ? "shipping_line"
                    : type === "customs_agent" ? "custom_agent"
                    : type === "clearing_agent" ? "clearing_agent"
                    : "bank"
                );
                if (!isFreight) setCostShippingLineId(0);
                if (isFreight) { setCostClearingAgentId(0); setCostCustomAgentId(0); setCostSupplierId(0); setCostBankAccountId(0); setCostIntermediaryId(0); }
              }} className="select-field">
                <option value="freight">Freight</option>
                <option value="customs_duty">Customs Duty</option>
                <option value="customs_agent">Customs Agent</option>
                <option value="clearing_agent">Clearing Agent</option>
                <option value="transport">Transport</option>
                <option value="loading_unloading">Loading / Unloading</option>
                <option value="port_charges">Port Charges</option>
                <option value="insurance">Insurance</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              {costForm.costType === "freight" ? (
                <select value={costForm.currencyCode} onChange={e => setCostForm(f => ({ ...f, currencyCode: e.target.value }))} className="select-field">
                  <option value="USD">USD</option>
                  <option value="CNY">CNY (Yuan)</option>
                </select>
              ) : isAfgLot ? (
                <select value={costForm.currencyCode} onChange={e => setCostForm(f => ({ ...f, currencyCode: e.target.value, exchangeRate: costNeedsRate(e.target.value) ? f.exchangeRate : "" }))} className="select-field">
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="AFN">AFN</option>
                </select>
              ) : (
                <input value="PKR" disabled className="input-field bg-gray-50 text-gray-500" />
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <input value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))}
              className="input-field" placeholder="e.g. Quetta city customs duty" />
          </div>
          {/* Charged To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Debit Channel</label>
            <div className="flex gap-2 mb-2">
              {(costForm.costType === "freight"
                ? [{ value: "shipping_line", label: "Shipping Line" }]
                : [
                  { value: "bank", label: "Bank Account" },
                  { value: "supplier", label: "Suppliers" },
                  { value: "clearing_agent", label: "Clearing Agents" },
                  { value: "custom_agent", label: "Custom Agents" },
                  { value: "intermediary", label: "Intermediary" },
                ]
              ).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setCostChargedTo(opt.value as any)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${costChargedTo === opt.value ? "bg-primary-600 text-white border-primary-600" : "bg-white text-gray-600 border-gray-300 hover:border-primary-400"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {costChargedTo === "shipping_line" && (
              <select value={costShippingLineId} onChange={e => setCostShippingLineId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Shipping Line</option>
                {shippingLines.map((sl: any) => <option key={sl.id} value={sl.id}>{sl.name}</option>)}
              </select>
            )}
            {costChargedTo === "supplier" && (
              <select value={costSupplierId} onChange={e => setCostSupplierId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Supplier</option>
                {suppliers.filter((s: any) => s.isActive !== false).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {costChargedTo === "clearing_agent" && (
              <select value={costClearingAgentId} onChange={e => setCostClearingAgentId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Clearing Agent</option>
                {agents.filter((a: any) => String(a.agentType || "").toLowerCase() !== "customs").map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {costChargedTo === "custom_agent" && (
              <select value={costCustomAgentId} onChange={e => setCostCustomAgentId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Custom Agent</option>
                {agents.filter((a: any) => String(a.agentType || "").toLowerCase() === "customs").map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {costChargedTo === "bank" && (
              <select value={costBankAccountId} onChange={e => setCostBankAccountId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Bank Account</option>
                {bankAccounts.filter((b: any) => b.isActive !== false).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}{b.currency?.code ? ` · ${b.currency.code}` : ""}{b.runningBalance != null ? ` · Avail: ${Number(b.runningBalance).toLocaleString("en-US")}` : ""}
                  </option>
                ))}
              </select>
            )}
            {costChargedTo === "intermediary" && (
              <select value={costIntermediaryId} onChange={e => setCostIntermediaryId(Number(e.target.value))} className="select-field">
                <option value={0}>Select Intermediary</option>
                {intermediaries.filter((i: any) => i.isActive !== false).map((i: any) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount * ({costForm.currencyCode})</label>
              <input type="number" value={costForm.amount} onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))}
                className="input-field" placeholder="0.00" min="0.01" step="0.01" onWheel={e => e.currentTarget.blur()} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={costForm.costDate} onChange={e => setCostForm(f => ({ ...f, costDate: e.target.value }))} className="input-field" />
            </div>
          </div>
          {costNeedsRate(costForm.currencyCode) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Acquisition rate ({costForm.currencyCode}→PKR) *
              </label>
              <input type="number" value={costForm.exchangeRate}
                onChange={e => setCostForm(f => ({ ...f, exchangeRate: e.target.value }))}
                className="input-field" placeholder="e.g. 280" min="0.01" step="0.01" />
              {Number(costForm.amount) > 0 && (
                <p className="mt-1 text-xs text-gray-500">≈ PKR {formatNumber(Math.round(Number(costForm.amount) * (Number(costForm.exchangeRate) || 0)))}</p>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={costForm.notes} onChange={e => setCostForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleAddCost} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Add Cost"}</button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════
          EDIT PURCHASE ITEM
      ══════════════════════════════════════ */}
      <Modal open={showEditPurchase} onClose={() => setShowEditPurchase(false)} title={`Edit: ${editPurchaseItem?.supplierName || ""} – ${editPurchaseItem?.productName || ""}`} size="sm">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wt/crt (kg)</label>
            <input type="number" value={editPurchaseForm.weightPerCartonKg}
              onChange={e => setEditPurchaseForm(f => ({ ...f, weightPerCartonKg: e.target.value }))}
              className="input-field" min="0.001" step="0.001" placeholder="e.g. 20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Qty (MT) *</label>
            <input type="number" value={editPurchaseForm.qtyMt}
              onChange={e => setEditPurchaseForm(f => ({ ...f, qtyMt: e.target.value }))}
              className="input-field" min="0.001" step="0.001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">USD/MT *</label>
            <input type="number" value={editPurchaseForm.unitPriceUsdPerMt}
              onChange={e => setEditPurchaseForm(f => ({ ...f, unitPriceUsdPerMt: e.target.value }))}
              className="input-field" min="0.01" step="0.01" />
          </div>
          {Number(editPurchaseForm.qtyMt) > 0 && Number(editPurchaseForm.unitPriceUsdPerMt) > 0 && (
            <div className="text-right text-sm font-semibold text-blue-700">
              Total: ${(Number(editPurchaseForm.qtyMt) * Number(editPurchaseForm.unitPriceUsdPerMt)).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEditPurchase} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════
          DISTRIBUTE
      ══════════════════════════════════════ */}
      <Modal open={showDistribute} onClose={() => setShowDistribute(false)} title={`${t("distribute")}: ${selectedLot?.lotNumber || ""}`} size="xl">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        {detailLoading
          ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-gray-400">{t("loading")}</p></div>
          : <>
          {/* City toggle filter */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 shrink-0">Cities:</span>
            {cities.map(c => {
              const on = enabledCityIds.has(c.id);
              return (
                <button key={c.id} type="button"
                  onClick={() => setEnabledCityIds(prev => { const s = new Set(prev); on ? s.delete(c.id) : s.add(c.id); return s; })}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? "bg-primary-600 text-white border-primary-600" : "bg-white text-gray-500 border-gray-300 hover:border-primary-300"}`}>
                  {c.name}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 mb-3">Click a product to expand · Toggle cities above to include/exclude them</p>

          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {(() => {
              const groups: Record<number, { productId: number; productName: string; maxQty: number; items: any[] }> = {};
              distributions.forEach((d: any, i: number) => {
                if (!enabledCityIds.has(d.cityId)) return; // skip disabled cities
                if (!groups[d.productId]) groups[d.productId] = { productId: d.productId, productName: d.productName, maxQty: d.maxQty, items: [] };
                groups[d.productId].items.push({ ...d, index: i });
              });
              return Object.values(groups).map((group) => {
                const totalAllocated = group.items.reduce((s: number, d: any) => s + (Number(d.allocatedQty) || 0), 0);
                const remaining  = group.maxQty - totalAllocated;
                const pct        = Math.min(100, group.maxQty > 0 ? (totalAllocated / group.maxQty) * 100 : 0);
                const isOver     = remaining < 0;
                const isDone     = remaining === 0;
                const isExpanded = expandedProductId === group.productId;
                const badgeCls   = isOver ? "bg-red-100 text-red-700 border-red-200" : isDone ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200";
                const barCls     = isOver ? "bg-red-500" : isDone ? "bg-green-500" : "bg-primary-500";
                return (
                  <div key={group.productId} className={`border rounded-xl overflow-hidden transition-all ${isExpanded ? "border-primary-300 shadow-sm" : "border-gray-200"}`}>
                    {/* Accordion header */}
                    <div className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${isExpanded ? "bg-primary-50" : "bg-gray-50"}`}>
                      <button type="button" onClick={() => setExpandedProductId(isExpanded ? null : group.productId)} className="flex-1 flex items-center gap-3 min-w-0">
                        <span className={`text-gray-400 transition-transform duration-200 shrink-0 ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                        <span className="font-semibold text-sm text-gray-800 w-24 shrink-0">{group.productName}</span>
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-300 ${barCls}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">{formatNumber(totalAllocated)} / {formatNumber(group.maxQty)} cartons</span>
                        </div>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${badgeCls}`}>
                          {isOver ? `⚠ ${formatNumber(Math.abs(remaining))} over` : isDone ? "✓ Complete" : `${formatNumber(remaining)} left`}
                        </span>
                      </button>
                      {/* Smart default buttons */}
                      <div className="flex gap-1 shrink-0">
                        <button type="button" onClick={() => evenSplit(group.productId)} title="Distribute evenly across enabled cities" className="px-2 py-1 text-xs rounded bg-white border border-gray-200 hover:border-primary-400 hover:text-primary-600 transition-colors">
                          ÷ Even
                        </button>
                        <button type="button" onClick={() => { setDistributions(prev => prev.map(d => d.productId === group.productId ? { ...d, allocatedQty: 0 } : d)); }} title="Clear all" className="px-2 py-1 text-xs rounded bg-white border border-gray-200 hover:border-red-300 hover:text-red-500 transition-colors">
                          ✕ Clear
                        </button>
                      </div>
                    </div>
                    {/* Expanded city rows */}
                    {isExpanded && (
                      <div className="divide-y divide-gray-100 bg-white">
                        {group.items.map((d: any) => (
                          <div key={d.index} className="flex items-center gap-3 px-5 py-2.5">
                            <span className="w-32 text-sm font-medium text-gray-700 shrink-0">{d.cityName}</span>
                            <input type="number" value={d.allocatedQty || ""} min={0} placeholder="0"
                              onChange={e => { const u = [...distributions]; u[d.index] = { ...u[d.index], allocatedQty: parseFloat(e.target.value) || 0 }; setDistributions(u); }}
                              className="input-field w-28" autoFocus={d.index === group.items[0].index} />
                            <span className="text-xs text-gray-400">cartons</span>
                            <button type="button" onClick={() => allToCity(group.productId, d.cityId)} className="text-xs text-primary-500 hover:underline ml-auto shrink-0">
                              All here
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
            <button onClick={handleDistribute} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save_distribution")}</button>
          </div>
        </>}
      </Modal>

      {/* ══════════════════════════════════════
          GODOWN ALLOCATION
      ══════════════════════════════════════ */}
      <Modal open={showGodownAlloc} onClose={() => setShowGodownAlloc(false)} title={`${t("assign_to_godowns")} — ${selectedLot?.lotNumber || ""}`} size="lg">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        {godownAllocs.length > 0 ? (() => {
          const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
          const maxQty     = godownAllocs[0]?.maxQty || 0;
          const remaining  = maxQty - totalAlloc;
          const isOver     = remaining < 0;
          const isDone     = remaining === 0;
          return (
            <div className="space-y-3">
              {/* Summary + smart buttons */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : isDone ? "bg-green-500" : "bg-primary-500"}`}
                      style={{ width: `${Math.min(100, maxQty > 0 ? (totalAlloc / maxQty) * 100 : 0)}%` }} />
                  </div>
                  <span className={`text-xs font-semibold ${isOver ? "text-red-600" : isDone ? "text-green-600" : "text-gray-500"}`}>
                    {formatNumber(totalAlloc)} / {formatNumber(maxQty)} allocated
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

              {/* Godown rows */}
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
          <button onClick={handleGodownAlloc} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════
          EDIT LOT
      ══════════════════════════════════════ */}
      <Modal open={showEditLot} onClose={() => setShowEditLot(false)} title={`${t("edit")}: ${editLotData?.lotNumber || ""}`} size="lg">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        {/* Cascade distribution warnings */}
        {editWarnings.length > 0 && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <p className="font-semibold text-amber-800 mb-1">⚠ Distribution mismatch — saved but please review:</p>
            {editWarnings.map((w, i) => <p key={i} className="text-amber-700 text-xs">{w}</p>)}
            <button onClick={() => { setShowEditLot(false); loadLots(); }} className="mt-2 text-xs text-primary-600 hover:underline">Close & refresh</button>
          </div>
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot_num")}</label>
              <input value={editLotData?.lotNumber || ""} onChange={e => setEditLotData((d: any) => ({ ...d, lotNumber: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
              <input value={editLotData?.notes || ""} onChange={e => setEditLotData((d: any) => ({ ...d, notes: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} & {t("cartons")}</label>
            {editProducts.map((p, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <select value={p.productId} onChange={e => { const u = [...editProducts]; u[i] = { ...u[i], productId: parseInt(e.target.value) }; setEditProducts(u); }} className="select-field flex-1">
                  <option value={0}>{t("select")}</option>
                  {products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select>
                <input type="number" value={p.totalQty || ""}
                  onChange={e => { const u = [...editProducts]; u[i] = { ...u[i], totalQty: parseFloat(e.target.value) || 0 }; setEditProducts(u); }}
                  className="input-field w-32" placeholder={t("cartons")} />
                {editProducts.length > 1 && <button onClick={() => setEditProducts(ep => ep.filter((_, idx) => idx !== i))} className="text-red-500 text-lg">×</button>}
              </div>
            ))}
            <button onClick={() => setEditProducts(ep => [...ep, { productId: 0, totalQty: 0 }])} className="text-primary-600 text-sm hover:underline">
              + {t("add_item")}
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEditLot} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
