"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { apiCall } from "@/hooks/useApi";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { applyPendingOpeningsData } from "@/lib/offline-openings";

const OPENINGS_READ_CACHE_KEY = "mrf-openings-read-cache-v1";

type OpeningData = {
  openingsLocked?: boolean;
  canEditOpenings?: boolean;
  cities: { id: number; name: string }[];
  selectedCityId: number | null;
  currencies: { id: number; code: string; symbol: string }[];
  customers: { id: number; name: string }[];
  godowns: { id: number; name: string }[];
  products: { id: number; name: string }[];
  bankAccounts: { id: number; bankName: string; accountNumber: string | null }[];
  openingCash: {
    id: number | string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  openingCustomerBalances: {
    id: number | string;
    customerId: number;
    customerName: string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  openingStocks: {
    id: number | string;
    lotId: number;
    lotNumber: string;
    godownId: number;
    godownName: string;
    productId: number;
    productName: string;
    qty: number;
    openingDate: string;
    _pending?: boolean;
  }[];
  legacyStocks?: {
    id: number | string;
    godownId: number;
    godownName: string;
    productId: number;
    productName: string;
    qty: number;
    legacyLotNumber?: string;
    _pending?: boolean;
  }[];
  ongoingLots?: { id: number; lotNumber: string; lotDate: string }[];
  historicalSales?: {
    id: number | string;
    voucherNo: string;
    saleDate: string;
    customerName: string;
    lotNumber: string;
    godownName: string;
    currencyCode: string;
    totalAmount: number;
    items: { productName: string; qty: number; amount: number }[];
    _pending?: boolean;
  }[];
  openingBankBalances: {
    id: number | string;
    bankAccountId: number;
    bankName: string;
    accountNumber?: string | null;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  openingCheques: {
    id: number | string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    chequeNumber: string;
    chequeBank?: string | null;
    chequeDueDate?: string | null;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  openingHajiBalances: {
    id: number | string;
    currencyId: number;
    currencyCode: string;
    currencySymbol?: string | null;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  liabilityOptions: {
    currencies: { id: number; code: string; symbol: string }[];
    suppliers: { id: number; name: string }[];
    shippingLines: { id: number; name: string }[];
    agents: { id: number; name: string; agentType: string }[];
    intermediaries: { id: number; name: string }[];
  };
  cityLiabilityOptions: {
    accounts: { id: number; name: string }[];
  };
  openingLiabilities: {
    id: number | string;
    liabilityType: "supplier" | "shipping_line" | "agent" | "intermediary";
    partyId: number;
    partyName: string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
  openingCityLiabilities: {
    id: number | string;
    accountId: number;
    accountName: string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
    _pending?: boolean;
  }[];
};

type CityCurrency = { id: number; code: string; symbol?: string };

function resolveCityCurrencyId(currencies: CityCurrency[], currentId: number): number {
  if (!currencies.length) return currentId;
  if (currencies.length === 1) return currencies[0].id;
  return currencies.some((c) => c.id === currentId) ? currentId : currencies[0].id;
}

function OpeningCurrencyField({
  currencies,
  value,
  onChange,
  disabled,
}: {
  currencies: CityCurrency[];
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
}) {
  if (currencies.length === 1) {
    return (
      <input
        className="input bg-neutral-50 text-neutral-700 cursor-default"
        value={currencies[0].code}
        readOnly
        tabIndex={-1}
        disabled={disabled}
        aria-label="Currency"
      />
    );
  }
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      required
      disabled={disabled}
    >
      <option value={0}>Currency</option>
      {currencies.map((c) => (
        <option key={c.id} value={c.id}>{c.code}</option>
      ))}
    </select>
  );
}

function SavedTable({
  title,
  emptyLabel,
  headers,
  rows,
}: {
  title: string;
  emptyLabel: string;
  headers: string[];
  rows: React.ReactNode[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500 bg-neutral-50 border-b border-neutral-200">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-neutral-400">{emptyLabel}</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 border-b bg-white">
              {headers.map((h) => (
                <th key={h} className="py-2 px-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      )}
    </div>
  );
}

export default function OpeningsPage() {
  const { user } = useAuth();
  const { isOnline, queuedItems } = useOffline();
  const isSuperAdmin = user?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpeningData | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<number>(0);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const cashRef = useRef<HTMLFormElement>(null);
  const customerRef = useRef<HTMLFormElement>(null);
  const bankRef = useRef<HTMLFormElement>(null);
  const chequeRef = useRef<HTMLFormElement>(null);
  const hajiRef = useRef<HTMLFormElement>(null);
  const stockRef = useRef<HTMLFormElement>(null);
  const historicalSaleRef = useRef<HTMLFormElement>(null);
  const legacyStockRef = useRef<HTMLFormElement>(null);
  const liabilityRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().split("T")[0];
  const [cashForm, setCashForm] = useState({ currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [customerForm, setCustomerForm] = useState({ customerId: 0, currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [bankForm, setBankForm] = useState({ bankAccountId: 0, currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [chequeForm, setChequeForm] = useState({
    currencyId: 0,
    amount: "",
    chequeNumber: "",
    chequeBank: "",
    chequeDueDate: "",
    openingDate: today,
    notes: "",
  });
  const [hajiForm, setHajiForm] = useState({ currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [stockForm, setStockForm] = useState({ lotId: 0, godownId: 0, productId: 0, qty: "" });
  const [legacyStockForm, setLegacyStockForm] = useState({ godownId: 0, productId: 0, qty: "" });
  const [historicalSaleForm, setHistoricalSaleForm] = useState({
    lotId: 0,
    customerId: 0,
    godownId: 0,
    productId: 0,
    currencyId: 0,
    qty: "",
    amount: "",
    saleDate: today,
    skipCustomerLedger: true,
    notes: "",
  });
  const [liabilityForm, setLiabilityForm] = useState<{
    liabilityType: "supplier" | "shipping_line" | "agent" | "intermediary";
    partyId: number;
    currencyId: number;
    amount: string;
    openingDate: string;
    notes: string;
  }>({
    liabilityType: "supplier",
    partyId: 0,
    currencyId: 0,
    amount: "",
    openingDate: today,
    notes: "",
  });
  const [cityLiabilityForm, setCityLiabilityForm] = useState({
    accountId: 0,
    currencyId: 0,
    amount: "",
    openingDate: today,
    notes: "",
  });

  const cityReady = !isSuperAdmin || selectedCityId > 0;
  const canEdit = data?.canEditOpenings !== false;
  const formsDisabled = !cityReady || !canEdit;

  const load = async (cityIdOverride?: number) => {
    setLoading(true);
    const cityId = cityIdOverride ?? selectedCityId;
    const params = isSuperAdmin && cityId > 0 ? { city_id: cityId } : undefined;
    const result = await apiCall<OpeningData>("/api/v1/openings", { params });
    if (result.success && result.data) {
      const nextData = applyPendingOpeningsData(result.data as any, queuedItems as any) as OpeningData;
      setData(nextData);
      writeOfflineReadSnapshot<OpeningData>(OPENINGS_READ_CACHE_KEY, nextData);
      setShowOfflineSnapshot(false);

      if (isSuperAdmin) {
        const resolvedCityId = cityId > 0
          ? cityId
          : (nextData.selectedCityId || nextData.cities[0]?.id || 0);
        if (resolvedCityId && resolvedCityId !== selectedCityId) setSelectedCityId(resolvedCityId);
      }

      const cityCurrencies = nextData.currencies;
      setCashForm((prev) => ({ ...prev, currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId) }));
      setCustomerForm((prev) => ({ ...prev, currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId) }));
      setHistoricalSaleForm((prev) => ({
        ...prev,
        currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId),
      }));
      setBankForm((prev) => ({ ...prev, currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId) }));
      setChequeForm((prev) => ({ ...prev, currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId) }));
      setHajiForm((prev) => ({ ...prev, currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId) }));
      if (!stockForm.lotId && nextData.ongoingLots?.[0]) {
        setStockForm((prev) => ({ ...prev, lotId: nextData.ongoingLots![0].id }));
      }
      if (!historicalSaleForm.lotId && nextData.ongoingLots?.[0]) {
        setHistoricalSaleForm((prev) => ({ ...prev, lotId: nextData.ongoingLots![0].id }));
      }
      if (!liabilityForm.currencyId && nextData.liabilityOptions?.currencies?.[0]) {
        setLiabilityForm((prev) => ({ ...prev, currencyId: nextData.liabilityOptions.currencies[0].id }));
      }
      setCityLiabilityForm((prev) => ({
        ...prev,
        currencyId: resolveCityCurrencyId(cityCurrencies, prev.currencyId),
        accountId: prev.accountId || nextData.cityLiabilityOptions?.accounts?.[0]?.id || 0,
      }));
    } else {
      const snapshot = readOfflineReadSnapshot<OpeningData>(OPENINGS_READ_CACHE_KEY)?.data;
      if (!isOnline && snapshot) {
        const nextData = applyPendingOpeningsData(snapshot as any, queuedItems as any) as OpeningData;
        setData(nextData);
        setShowOfflineSnapshot(true);
      } else {
        toast.error(result.error || "Failed to load openings");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSuperAdmin || !selectedCityId) return;
    load(selectedCityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCityId, isSuperAdmin]);

  const liabilityPartyOptions = useMemo(() => {
    if (!data) return [];
    if (liabilityForm.liabilityType === "supplier") return data.liabilityOptions.suppliers;
    if (liabilityForm.liabilityType === "shipping_line") return data.liabilityOptions.shippingLines;
    if (liabilityForm.liabilityType === "agent") return data.liabilityOptions.agents;
    return data.liabilityOptions.intermediaries;
  }, [data, liabilityForm.liabilityType]);

  const scrollTo = (ref: React.RefObject<HTMLFormElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteOpening = async (kind: string, id: number | string) => {
    if (String(id).startsWith("pending-")) return toast.error("Cannot delete pending sync row");
    if (!window.confirm("Delete this opening entry?")) return;
    const params: Record<string, string | number> = { kind, id: Number(id) };
    if (isSuperAdmin && selectedCityId > 0) params.city_id = selectedCityId;
    const result = await apiCall("/api/v1/openings", { method: "DELETE", params });
    if (!result.success) return toast.error(result.error || "Failed to delete");
    toast.success("Opening entry deleted");
    load();
  };

  const submitCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "cash",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        currencyId: cashForm.currencyId,
        amount: Number(cashForm.amount || 0),
        openingDate: cashForm.openingDate,
        notes: cashForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening cash saved");
    setCashForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  const submitCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "customer",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        customerId: customerForm.customerId,
        currencyId: customerForm.currencyId,
        amount: Number(customerForm.amount || 0),
        openingDate: customerForm.openingDate,
        notes: customerForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening customer balance saved");
    setCustomerForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  const submitBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "bank",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        bankAccountId: bankForm.bankAccountId,
        currencyId: bankForm.currencyId,
        amount: Number(bankForm.amount || 0),
        openingDate: bankForm.openingDate,
        notes: bankForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening bank balance saved");
    setBankForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  const submitCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    if (!chequeForm.chequeNumber.trim()) return toast.error("Enter cheque number");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "cheque",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        currencyId: chequeForm.currencyId,
        amount: Number(chequeForm.amount || 0),
        chequeNumber: chequeForm.chequeNumber.trim(),
        chequeBank: chequeForm.chequeBank.trim() || null,
        chequeDueDate: chequeForm.chequeDueDate || null,
        openingDate: chequeForm.openingDate,
        notes: chequeForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening cheque saved");
    setChequeForm((prev) => ({
      ...prev,
      amount: "",
      chequeNumber: "",
      chequeBank: "",
      chequeDueDate: "",
      notes: "",
    }));
    load();
  };

  const submitHaji = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "haji",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        currencyId: hajiForm.currencyId,
        amount: Number(hajiForm.amount || 0),
        openingDate: hajiForm.openingDate,
        notes: hajiForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening Haji balance saved");
    setHajiForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  const submitStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    if (!stockForm.lotId) return toast.error("Select an ongoing lot");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "stock",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        lotId: stockForm.lotId,
        godownId: stockForm.godownId,
        productId: stockForm.productId,
        qty: Number(stockForm.qty || 0),
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Godown stock saved on ongoing lot");
    setStockForm((prev) => ({ ...prev, qty: "" }));
    load();
  };

  const submitLegacyStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "stock",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        useLegacy: true,
        godownId: legacyStockForm.godownId,
        productId: legacyStockForm.productId,
        qty: Number(legacyStockForm.qty || 0),
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Legacy stock saved on OLD-STOCK lot");
    setLegacyStockForm((prev) => ({ ...prev, qty: "" }));
    load();
  };

  const submitHistoricalSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    if (!cityReady) return toast.error("Select a city first");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "historical_sale",
        cityId: isSuperAdmin ? selectedCityId : undefined,
        lotId: historicalSaleForm.lotId,
        customerId: historicalSaleForm.customerId,
        godownId: historicalSaleForm.godownId,
        productId: historicalSaleForm.productId,
        currencyId: historicalSaleForm.currencyId,
        qty: Number(historicalSaleForm.qty || 0),
        amount: Number(historicalSaleForm.amount || 0),
        saleDate: historicalSaleForm.saleDate,
        skipCustomerLedger: historicalSaleForm.skipCustomerLedger,
        notes: historicalSaleForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Historical sale imported");
    setHistoricalSaleForm((prev) => ({ ...prev, qty: "", amount: "", notes: "" }));
    load();
  };

  const submitLiability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    const partyName = liabilityPartyOptions.find((party) => party.id === liabilityForm.partyId)?.name || "Pending Party";
    const currencyCode = data?.liabilityOptions.currencies.find((currency) => currency.id === liabilityForm.currencyId)?.code || "";
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "liability",
        liabilityType: liabilityForm.liabilityType,
        partyId: liabilityForm.partyId,
        partyName,
        currencyId: liabilityForm.currencyId,
        currencyCode,
        amount: Number(liabilityForm.amount || 0),
        openingDate: liabilityForm.openingDate,
        notes: liabilityForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening liability saved");
    setLiabilityForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  const submitCityLiability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return toast.error("Opening entries are locked");
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "city_liability",
        accountId: cityLiabilityForm.accountId,
        currencyId: cityLiabilityForm.currencyId,
        amount: Number(cityLiabilityForm.amount || 0),
        openingDate: cityLiabilityForm.openingDate,
        notes: cityLiabilityForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening city liability saved");
    setCityLiabilityForm((prev) => ({ ...prev, amount: "", notes: "" }));
    load();
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-72" />
        <div className="skeleton h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Opening Entries" />
      {showOfflineSnapshot && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      {data?.openingsLocked && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {canEdit
            ? "Go-live lock is active — only super admin can edit opening entries."
            : "Opening entries are locked after go-live. Contact super admin to make changes."}
        </div>
      )}

      {isSuperAdmin && (
        <div className="card">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500 mb-3">City scope</h2>
          <select className="input max-w-sm" value={selectedCityId} onChange={(e) => setSelectedCityId(Number(e.target.value))}>
            <option value={0}>Select city</option>
            {(data?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {!cityReady && isSuperAdmin && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Select a city above to enter or view opening cash, receivables, and stock.
        </div>
      )}

      {/* Step 1: Opening cash */}
      <form ref={cashRef} onSubmit={submitCash} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening balance (cash)</h2>
          <p className="text-xs text-neutral-500 mt-1">Sets the opening cash balance for this city and currency. Saving again replaces the previous value.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={cashForm.currencyId}
            onChange={(currencyId) => setCashForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={cashForm.amount}
            onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={cashForm.openingDate}
            onChange={(e) => setCashForm((prev) => ({ ...prev, openingDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input lg:col-span-2"
            placeholder="Notes (optional)"
            value={cashForm.notes}
            onChange={(e) => setCashForm((prev) => ({ ...prev, notes: e.target.value }))}
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save opening cash</button>

        <SavedTable
          title="Saved opening cash"
          emptyLabel="No opening cash recorded for this city yet."
          headers={["Currency", "Amount", "Date", "Notes", ""]}
          rows={(data?.openingCash || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.currencyCode}{row._pending ? " (pending sync)" : ""}</td>
              <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setCashForm({
                          currencyId: row.currencyId,
                          amount: String(row.amount),
                          openingDate: row.openingDate,
                          notes: row.notes || "",
                        });
                        scrollTo(cashRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("cash", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Step 1b: Opening Haji balance */}
      <form ref={hajiRef} onSubmit={submitHaji} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening Haji balance</h2>
          <p className="text-xs text-neutral-500 mt-1">Sets the opening amount owed to Haji for this city and currency. Saving again replaces the previous value.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={hajiForm.currencyId}
            onChange={(currencyId) => setHajiForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={hajiForm.amount}
            onChange={(e) => setHajiForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={hajiForm.openingDate}
            onChange={(e) => setHajiForm((prev) => ({ ...prev, openingDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input lg:col-span-2"
            placeholder="Notes (optional)"
            value={hajiForm.notes}
            onChange={(e) => setHajiForm((prev) => ({ ...prev, notes: e.target.value }))}
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save Haji opening</button>

        <SavedTable
          title="Saved Haji opening balances"
          emptyLabel="No opening Haji balances for this city yet."
          headers={["Currency", "Amount", "Date", "Notes", ""]}
          rows={(data?.openingHajiBalances || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.currencyCode}</td>
              <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setHajiForm({
                          currencyId: row.currencyId,
                          amount: String(row.amount),
                          openingDate: row.openingDate,
                          notes: row.notes || "",
                        });
                        scrollTo(hajiRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("haji", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Step 2: Customer receivables */}
      <form ref={customerRef} onSubmit={submitCustomer} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening customer receivable</h2>
          <p className="text-xs text-neutral-500 mt-1">Sets opening amount owed by a customer. One row per customer + currency.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-3">
          <select
            className="input"
            value={customerForm.customerId}
            onChange={(e) => setCustomerForm((prev) => ({ ...prev, customerId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Customer</option>
            {(data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={customerForm.currencyId}
            onChange={(currencyId) => setCustomerForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={customerForm.amount}
            onChange={(e) => setCustomerForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={customerForm.openingDate}
            onChange={(e) => setCustomerForm((prev) => ({ ...prev, openingDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input lg:col-span-2"
            placeholder="Notes (optional)"
            value={customerForm.notes}
            onChange={(e) => setCustomerForm((prev) => ({ ...prev, notes: e.target.value }))}
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save customer opening</button>

        <SavedTable
          title="Saved customer receivables"
          emptyLabel="No opening customer balances for this city yet."
          headers={["Customer", "Currency", "Amount", "Date", "Notes", ""]}
          rows={(data?.openingCustomerBalances || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.customerName}</td>
              <td className="py-2 px-3">{row.currencyCode}</td>
              <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setCustomerForm({
                          customerId: row.customerId,
                          currencyId: row.currencyId,
                          amount: String(row.amount),
                          openingDate: row.openingDate,
                          notes: row.notes || "",
                        });
                        scrollTo(customerRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("customer", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Historical sales (pre-cutover) */}
      <form ref={historicalSaleRef} onSubmit={submitHistoricalSale} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Historical sales (pre-cutover)</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Backfill sales sold before go-live on an ongoing lot. Qty drives lot/godown stock; amounts count toward owed-to-Haji on that lot.
            When opening customer balance already covers receivables, keep &quot;Skip customer ledger&quot; checked so the sale does not add customer debit.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            className="input"
            value={historicalSaleForm.lotId}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, lotId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Ongoing lot</option>
            {(data?.ongoingLots || []).map((l) => (
              <option key={l.id} value={l.id}>{l.lotNumber} ({l.lotDate})</option>
            ))}
          </select>
          <select
            className="input"
            value={historicalSaleForm.customerId}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, customerId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Customer</option>
            {(data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            className="input"
            value={historicalSaleForm.godownId}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, godownId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Godown</option>
            {(data?.godowns || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select
            className="input"
            value={historicalSaleForm.productId}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, productId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Product</option>
            {(data?.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={historicalSaleForm.currencyId}
            onChange={(currencyId) => setHistoricalSaleForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Qty (cartons)"
            value={historicalSaleForm.qty}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, qty: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={historicalSaleForm.amount}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={historicalSaleForm.saleDate}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, saleDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input lg:col-span-2"
            placeholder="Notes (optional)"
            value={historicalSaleForm.notes}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, notes: e.target.value }))}
            disabled={formsDisabled}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={historicalSaleForm.skipCustomerLedger}
            onChange={(e) => setHistoricalSaleForm((prev) => ({ ...prev, skipCustomerLedger: e.target.checked }))}
            disabled={formsDisabled}
          />
          Skip customer ledger (stock/Haji only — use when opening customer balance covers receivables)
        </label>
        <button className="btn-primary" type="submit" disabled={formsDisabled || !(data?.ongoingLots?.length)}>Import historical sale</button>

        <SavedTable
          title="Imported historical sales"
          emptyLabel="No historical sales imported for this city yet."
          headers={["Voucher", "Date", "Customer", "Lot", "Godown", "Currency", "Amount", "Items", ""]}
          rows={(data?.historicalSales || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.voucherNo}{row._pending ? " (pending sync)" : ""}</td>
              <td className="py-2 px-3">{row.saleDate}</td>
              <td className="py-2 px-3">{row.customerName}</td>
              <td className="py-2 px-3">{row.lotNumber}</td>
              <td className="py-2 px-3">{row.godownName}</td>
              <td className="py-2 px-3">{row.currencyCode}</td>
              <td className="py-2 px-3">{row.totalAmount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3 text-neutral-500">
                {row.items.map((i) => `${i.productName} × ${i.qty}`).join(", ")}
              </td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => deleteOpening("historical_sale", row.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Step 2b: Opening bank balances */}
      <form ref={bankRef} onSubmit={submitBank} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening bank balance</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Sets the starting balance for a city bank account + currency. Saving again replaces that row.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
          <select
            className="input"
            value={bankForm.bankAccountId}
            onChange={(e) => setBankForm((prev) => ({ ...prev, bankAccountId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Bank account</option>
            {(data?.bankAccounts || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}
              </option>
            ))}
          </select>
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={bankForm.currencyId}
            onChange={(currencyId) => setBankForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={bankForm.amount}
            onChange={(e) => setBankForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={bankForm.openingDate}
            onChange={(e) => setBankForm((prev) => ({ ...prev, openingDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            placeholder="Notes (optional)"
            value={bankForm.notes}
            onChange={(e) => setBankForm((prev) => ({ ...prev, notes: e.target.value }))}
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save opening bank balance</button>

        <SavedTable
          title="Saved opening bank balances"
          emptyLabel="No opening bank balances for this city yet."
          headers={["Bank", "Currency", "Amount", "Date", "Notes", ""]}
          rows={(data?.openingBankBalances || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">
                {row.bankName}
                {row.accountNumber ? ` (${row.accountNumber})` : ""}
                {row._pending ? " (pending sync)" : ""}
              </td>
              <td className="py-2 px-3">{row.currencyCode}</td>
              <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setBankForm({
                          bankAccountId: row.bankAccountId,
                          currencyId: row.currencyId,
                          amount: String(row.amount),
                          openingDate: row.openingDate,
                          notes: row.notes || "",
                        });
                        scrollTo(bankRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("bank", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Step 2c: Opening cheques in hand */}
      <form ref={chequeRef} onSubmit={submitCheque} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening cheques in hand</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Pre-go-live cheques held in the office (count toward cheques-in-hand in treasury). Each save adds a row.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-3">
          <OpeningCurrencyField
            currencies={data?.currencies || []}
            value={chequeForm.currencyId}
            onChange={(currencyId) => setChequeForm((prev) => ({ ...prev, currencyId }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount"
            value={chequeForm.amount}
            onChange={(e) => setChequeForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            placeholder="Cheque #"
            value={chequeForm.chequeNumber}
            onChange={(e) => setChequeForm((prev) => ({ ...prev, chequeNumber: e.target.value }))}
            required
            disabled={formsDisabled}
          />
          <input
            className="input"
            placeholder="Drawee bank"
            value={chequeForm.chequeBank}
            onChange={(e) => setChequeForm((prev) => ({ ...prev, chequeBank: e.target.value }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={chequeForm.chequeDueDate}
            onChange={(e) => setChequeForm((prev) => ({ ...prev, chequeDueDate: e.target.value }))}
            disabled={formsDisabled}
          />
          <input
            className="input"
            type="date"
            value={chequeForm.openingDate}
            onChange={(e) => setChequeForm((prev) => ({ ...prev, openingDate: e.target.value }))}
            required
            disabled={formsDisabled}
          />
        </div>
        <input
          className="input"
          placeholder="Notes (optional)"
          value={chequeForm.notes}
          onChange={(e) => setChequeForm((prev) => ({ ...prev, notes: e.target.value }))}
          disabled={formsDisabled}
        />
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save opening cheque</button>

        <SavedTable
          title="Saved opening cheques"
          emptyLabel="No opening cheques recorded for this city yet."
          headers={["Cheque #", "Bank", "Currency", "Amount", "Due", "Date", "Notes", ""]}
          rows={(data?.openingCheques || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.chequeNumber}{row._pending ? " (pending sync)" : ""}</td>
              <td className="py-2 px-3">{row.chequeBank || "—"}</td>
              <td className="py-2 px-3">{row.currencyCode}</td>
              <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.chequeDueDate || "—"}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => deleteOpening("cheque", row.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Ongoing lot godown stock */}
      <form ref={stockRef} onSubmit={submitStock} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening godown stock (ongoing lots)</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Set <span className="font-medium">gross</span> quantity received into a godown on an ongoing lot (not net on-hand).
            Import historical sales separately for the sold portion. Saving replaces the qty for that lot + godown + product.
          </p>
          {isSuperAdmin && (data?.ongoingLots?.length || 0) === 0 && cityReady && (
            <p className="text-xs mt-1">
              No ongoing lots for this city yet — create and distribute lots in{" "}
              <Link href="/lots" className="text-primary-600 hover:underline">Lots</Link> first.
            </p>
          )}
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            className="input"
            value={stockForm.lotId}
            onChange={(e) => setStockForm((prev) => ({ ...prev, lotId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Ongoing lot</option>
            {(data?.ongoingLots || []).map((l) => (
              <option key={l.id} value={l.id}>{l.lotNumber} ({l.lotDate})</option>
            ))}
          </select>
          <select
            className="input"
            value={stockForm.godownId}
            onChange={(e) => setStockForm((prev) => ({ ...prev, godownId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Godown</option>
            {(data?.godowns || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select
            className="input"
            value={stockForm.productId}
            onChange={(e) => setStockForm((prev) => ({ ...prev, productId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Product</option>
            {(data?.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Gross qty (cartons)"
            value={stockForm.qty}
            onChange={(e) => setStockForm((prev) => ({ ...prev, qty: e.target.value }))}
            required
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled || !(data?.ongoingLots?.length)}>Save godown stock</button>

        <SavedTable
          title="Saved godown stock (ongoing lots)"
          emptyLabel="No godown allocations on ongoing lots for this city yet."
          headers={["Lot", "Godown", "Product", "Gross qty", "Lot date", ""]}
          rows={(data?.openingStocks || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">
                {isSuperAdmin ? (
                  <Link href={`/lots?lotId=${row.lotId}`} className="text-primary-600 hover:underline">
                    {row.lotNumber}
                  </Link>
                ) : (
                  row.lotNumber
                )}
                {row._pending ? " (pending sync)" : ""}
              </td>
              <td className="py-2 px-3">{row.godownName}</td>
              <td className="py-2 px-3">{row.productName}</td>
              <td className="py-2 px-3">{row.qty.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.openingDate}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setStockForm({
                          lotId: row.lotId,
                          godownId: row.godownId,
                          productId: row.productId,
                          qty: String(row.qty),
                        });
                        scrollTo(stockRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("stock", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Legacy stock (OLD-STOCK) — untraceable only */}
      <form ref={legacyStockRef} onSubmit={submitLegacyStock} className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Legacy stock (OLD-STOCK)</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Only for stock with no lot identity. Sets net on-hand on the country&apos;s{" "}
            <span className="font-medium">OLD-STOCK</span> lot. Prefer ongoing lots + historical sales when lot history is known.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <select
            className="input"
            value={legacyStockForm.godownId}
            onChange={(e) => setLegacyStockForm((prev) => ({ ...prev, godownId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Godown</option>
            {(data?.godowns || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select
            className="input"
            value={legacyStockForm.productId}
            onChange={(e) => setLegacyStockForm((prev) => ({ ...prev, productId: Number(e.target.value) }))}
            required
            disabled={formsDisabled}
          >
            <option value={0}>Product</option>
            {(data?.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="On-hand qty (cartons)"
            value={legacyStockForm.qty}
            onChange={(e) => setLegacyStockForm((prev) => ({ ...prev, qty: e.target.value }))}
            required
            disabled={formsDisabled}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={formsDisabled}>Save legacy stock</button>

        <SavedTable
          title="Saved legacy stock (OLD-STOCK lot)"
          emptyLabel="No legacy stock in godowns for this city yet."
          headers={["Godown", "Product", "On-hand qty", "Lot", ""]}
          rows={(data?.legacyStocks || []).map((row) => (
            <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
              <td className="py-2 px-3">{row.godownName}</td>
              <td className="py-2 px-3">{row.productName}</td>
              <td className="py-2 px-3">{row.qty.toLocaleString("en-US")}</td>
              <td className="py-2 px-3">{row.legacyLotNumber || "OLD-STOCK"}{row._pending ? " (pending sync)" : ""}</td>
              <td className="py-2 px-3">
                {!row._pending && canEdit && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary-600 hover:underline"
                      onClick={() => {
                        setLegacyStockForm({
                          godownId: row.godownId,
                          productId: row.productId,
                          qty: String(row.qty),
                        });
                        scrollTo(legacyStockRef);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => deleteOpening("stock", row.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        />
      </form>

      {/* Step 4: City Liabilities */}
      {!isSuperAdmin && (
        <form onSubmit={submitCityLiability} className="card space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening liabilities</h2>
            <p className="text-xs text-neutral-500 mt-1">Starting balances for loading/unloading liability accounts. Saving replaces the row for that account + currency.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
            <select
              className="input"
              value={cityLiabilityForm.accountId}
              onChange={(e) => setCityLiabilityForm((prev) => ({ ...prev, accountId: Number(e.target.value) }))}
              required
              disabled={formsDisabled}
            >
              <option value={0}>Liability account</option>
              {(data?.cityLiabilityOptions?.accounts || []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <select
              className="input"
              value={cityLiabilityForm.currencyId}
              onChange={(e) => setCityLiabilityForm((prev) => ({ ...prev, currencyId: Number(e.target.value) }))}
              required
              disabled={formsDisabled}
            >
              <option value={0}>Currency</option>
              {(data?.currencies || []).map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
            </select>
            <input
              className="input"
              type="number"
              step="0.01"
              placeholder="Amount"
              value={cityLiabilityForm.amount}
              onChange={(e) => setCityLiabilityForm((prev) => ({ ...prev, amount: e.target.value }))}
              required
              disabled={formsDisabled}
            />
            <input
              className="input"
              type="date"
              value={cityLiabilityForm.openingDate}
              onChange={(e) => setCityLiabilityForm((prev) => ({ ...prev, openingDate: e.target.value }))}
              required
              disabled={formsDisabled}
            />
            <input
              className="input"
              placeholder="Notes (optional)"
              value={cityLiabilityForm.notes}
              onChange={(e) => setCityLiabilityForm((prev) => ({ ...prev, notes: e.target.value }))}
              disabled={formsDisabled}
            />
          </div>
          <button className="btn-primary" type="submit" disabled={formsDisabled}>Save opening liability</button>

          <SavedTable
            title="Saved opening liabilities"
            emptyLabel="No opening liabilities recorded yet."
            headers={["Account", "Currency", "Amount", "Date", "Notes", ""]}
            rows={(data?.openingCityLiabilities || []).map((row) => (
              <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
                <td className="py-2 px-3">{row.accountName}</td>
                <td className="py-2 px-3">{row.currencyCode}</td>
                <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
                <td className="py-2 px-3">{row.openingDate}</td>
                <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
                <td className="py-2 px-3">
                  {!row._pending && canEdit && (
                    <span className="inline-flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-primary-600 hover:underline"
                        onClick={() => setCityLiabilityForm({
                          accountId: row.accountId,
                          currencyId: row.currencyId,
                          amount: String(row.amount),
                          openingDate: row.openingDate,
                          notes: row.notes || "",
                        })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => deleteOpening("city_liability", row.id)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          />
        </form>
      )}

      {/* Step 5: Party opening balances (super admin) */}
      {isSuperAdmin && (
        <>
          <form ref={liabilityRef} onSubmit={submitLiability} className="card space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening party balances</h2>
              <p className="text-xs text-neutral-500 mt-1">Suppliers, shipping lines, and agents are payables. An intermediary balance is a receivable owed to us.</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-3">
              <select
                className="input"
                value={liabilityForm.liabilityType}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, liabilityType: e.target.value as any, partyId: 0 }))}
                required
                disabled={!canEdit}
              >
                <option value="supplier">Supplier</option>
                <option value="shipping_line">Shipping line</option>
                <option value="agent">Agent</option>
                <option value="intermediary">Intermediary receivable (owes us)</option>
              </select>
              <select
                className="input"
                value={liabilityForm.partyId}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, partyId: Number(e.target.value) }))}
                required
                disabled={!canEdit}
              >
                <option value={0}>Party</option>
                {liabilityPartyOptions.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                className="input"
                value={liabilityForm.currencyId}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, currencyId: Number(e.target.value) }))}
                required
                disabled={!canEdit}
              >
                <option value={0}>Currency</option>
                {(data?.liabilityOptions?.currencies || []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="Amount"
                value={liabilityForm.amount}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, amount: e.target.value }))}
                required
                disabled={!canEdit}
              />
              <input
                className="input"
                type="date"
                value={liabilityForm.openingDate}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, openingDate: e.target.value }))}
                required
                disabled={!canEdit}
              />
              <input
                className="input"
                placeholder="Notes (optional)"
                value={liabilityForm.notes}
                onChange={(e) => setLiabilityForm((prev) => ({ ...prev, notes: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
            <button className="btn-primary" type="submit" disabled={!canEdit}>Save opening balance</button>

            <SavedTable
              title="Saved opening party balances"
              emptyLabel="No opening party balances recorded yet."
              headers={["Type", "Party", "Currency", "Amount", "Date", "Notes", ""]}
              rows={(data?.openingLiabilities || []).map((row) => (
                <tr key={String(row.id)} className={`border-b last:border-0 ${row._pending ? "bg-amber-50/60" : ""}`}>
                  <td className="py-2 px-3">{row.liabilityType === "intermediary" ? "intermediary receivable" : row.liabilityType.replace("_", " ")}</td>
                  <td className="py-2 px-3">{row.partyName}</td>
                  <td className="py-2 px-3">{row.currencyCode}</td>
                  <td className="py-2 px-3">{row.amount.toLocaleString("en-US")}</td>
                  <td className="py-2 px-3">{row.openingDate}</td>
                  <td className="py-2 px-3 text-neutral-500">{row.notes || "—"}</td>
                  <td className="py-2 px-3">
                    {!row._pending && canEdit && (
                      <span className="inline-flex gap-2">
                        <button
                          type="button"
                          className="text-xs text-primary-600 hover:underline"
                          onClick={() => {
                            setLiabilityForm({
                              liabilityType: row.liabilityType,
                              partyId: row.partyId,
                              currencyId: row.currencyId,
                              amount: String(row.amount),
                              openingDate: row.openingDate,
                              notes: row.notes || "",
                            });
                            scrollTo(liabilityRef);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => deleteOpening("liability", row.id)}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            />
          </form>
        </>
      )}
    </div>
  );
}
