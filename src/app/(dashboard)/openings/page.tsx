"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiCall } from "@/hooks/useApi";

type OpeningData = {
  currencies: { id: number; code: string; symbol: string }[];
  customers: { id: number; name: string }[];
  godowns: { id: number; name: string }[];
  products: { id: number; name: string }[];
  openingCash: {
    id: number;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
  }[];
  openingCustomerBalances: {
    id: number;
    customerId: number;
    customerName: string;
    currencyId: number;
    currencyCode: string;
    amount: number;
    openingDate: string;
    notes?: string | null;
  }[];
  openingStocks: {
    id: number;
    godownId: number;
    godownName: string;
    productId: number;
    productName: string;
    qty: number;
    openingDate: string;
    notes?: string | null;
  }[];
};

export default function OpeningsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpeningData | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [cashForm, setCashForm] = useState({ currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [customerForm, setCustomerForm] = useState({ customerId: 0, currencyId: 0, amount: "", openingDate: today, notes: "" });
  const [stockForm, setStockForm] = useState({ godownId: 0, productId: 0, qty: "", openingDate: today, notes: "" });

  const load = async () => {
    setLoading(true);
    const result = await apiCall<OpeningData>("/api/v1/openings");
    if (result.success && result.data) {
      setData(result.data);
      if (!cashForm.currencyId && result.data.currencies[0]) {
        setCashForm((prev) => ({ ...prev, currencyId: result.data!.currencies[0].id }));
      }
      if (!customerForm.currencyId && result.data.currencies[0]) {
        setCustomerForm((prev) => ({ ...prev, currencyId: result.data!.currencies[0].id }));
      }
    } else {
      toast.error(result.error || "Failed to load openings");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitCash = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "cash",
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
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "customer",
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

  const submitStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await apiCall("/api/v1/openings", {
      method: "POST",
      body: {
        kind: "stock",
        godownId: stockForm.godownId,
        productId: stockForm.productId,
        qty: Number(stockForm.qty || 0),
        openingDate: stockForm.openingDate,
        notes: stockForm.notes || null,
      },
    });
    if (!result.success) return toast.error(result.error || "Failed");
    toast.success("Opening stock saved");
    setStockForm((prev) => ({ ...prev, qty: "", notes: "" }));
    load();
  };

  if (loading && !data) return <div className="space-y-4"><div className="skeleton h-8 w-72" /><div className="skeleton h-28 w-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="card">
        <p className="text-xs tracking-[0.24em] uppercase text-neutral-500">Setup</p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-2">Opening Entries</h1>
        <p className="text-sm text-neutral-600 mt-1">Set starting cash, customer receivables, and stock for this city.</p>
      </div>

      <form onSubmit={submitCash} className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening Cash</h2>
        <div className="grid md:grid-cols-4 gap-3">
          <select className="input" value={cashForm.currencyId} onChange={(e) => setCashForm((prev) => ({ ...prev, currencyId: Number(e.target.value) }))} required>
            <option value={0}>Currency</option>
            {(data?.currencies || []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <input className="input" type="number" step="0.01" placeholder="Amount" value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
          <input className="input" type="date" value={cashForm.openingDate} onChange={(e) => setCashForm((prev) => ({ ...prev, openingDate: e.target.value }))} required />
          <button className="btn-primary" type="submit">Save Cash Opening</button>
        </div>
      </form>

      <form onSubmit={submitCustomer} className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening Customer Receivable</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <select className="input" value={customerForm.customerId} onChange={(e) => setCustomerForm((prev) => ({ ...prev, customerId: Number(e.target.value) }))} required>
            <option value={0}>Customer</option>
            {(data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={customerForm.currencyId} onChange={(e) => setCustomerForm((prev) => ({ ...prev, currencyId: Number(e.target.value) }))} required>
            <option value={0}>Currency</option>
            {(data?.currencies || []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <input className="input" type="number" step="0.01" placeholder="Amount" value={customerForm.amount} onChange={(e) => setCustomerForm((prev) => ({ ...prev, amount: e.target.value }))} required />
          <input className="input" type="date" value={customerForm.openingDate} onChange={(e) => setCustomerForm((prev) => ({ ...prev, openingDate: e.target.value }))} required />
          <button className="btn-primary" type="submit">Save Customer Opening</button>
        </div>
      </form>

      <form onSubmit={submitStock} className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-neutral-500">Opening Stock</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <select className="input" value={stockForm.godownId} onChange={(e) => setStockForm((prev) => ({ ...prev, godownId: Number(e.target.value) }))} required>
            <option value={0}>Godown</option>
            {(data?.godowns || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className="input" value={stockForm.productId} onChange={(e) => setStockForm((prev) => ({ ...prev, productId: Number(e.target.value) }))} required>
            <option value={0}>Product</option>
            {(data?.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input" type="number" step="0.01" placeholder="Qty" value={stockForm.qty} onChange={(e) => setStockForm((prev) => ({ ...prev, qty: e.target.value }))} required />
          <input className="input" type="date" value={stockForm.openingDate} onChange={(e) => setStockForm((prev) => ({ ...prev, openingDate: e.target.value }))} required />
          <button className="btn-primary" type="submit">Save Stock Opening</button>
        </div>
      </form>
    </div>
  );
}
