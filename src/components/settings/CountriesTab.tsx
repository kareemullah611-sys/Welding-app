"use client";

import { useEffect, useRef, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { DataTable, Modal } from "@/components/ui";

type Country = { id: number; name: string; code: string; citiesCount: number };

export default function CountriesTab() {
  const { isOnline } = useOffline();
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    apiCall<Country[]>("/api/v1/countries").then((result) => {
      if (!active) return;
      if (result.success) setCountries(result.data || []);
      else setLoadError(result.error || "Unable to load countries");
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !isOnline) return;
    locked.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await apiCall<Country>("/api/v1/countries", {
        method: "POST", body: { name: name.trim(), code: code.trim().toUpperCase() },
      });
      if (!result.success || !result.data) {
        setError(result.error || "Unable to create country");
        return;
      }
      const created = result.data;
      setCountries((rows) => [...rows, created].sort((a, b) => a.name.localeCompare(b.name)));
      setOpen(false);
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }

  return <>
    {loadError && <div role="alert" className="mb-3 text-red-700">{loadError}</div>}
    {!isOnline && <p className="mb-3 text-sm text-gray-500">Connect to the server to create a country.</p>}
    <div className="flex justify-end mb-4">
      <button className="btn-primary text-sm" disabled={!isOnline} onClick={() => { setName(""); setCode(""); setError(""); setOpen(true); }}>+ New Country</button>
    </div>
    <DataTable columns={[
      { key: "name", label: "Country" },
      { key: "code", label: "Code" },
      { key: "citiesCount", label: "Cities" },
    ]} data={countries} loading={loading} />
    <Modal open={open} onClose={() => { if (!locked.current) setOpen(false); }} title="New Country" size="sm">
      <form onSubmit={create} className="space-y-3">
        {error && <div role="alert" className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div><label htmlFor="country-name" className="block text-sm font-medium text-gray-700 mb-1">Country name</label>
          <input id="country-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} disabled={submitting} /></div>
        <div><label htmlFor="country-code" className="block text-sm font-medium text-gray-700 mb-1">Country code</label>
          <input id="country-code" className="input-field" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required pattern="[A-Za-z]{2}" maxLength={2} disabled={submitting} />
          <p className="mt-1 text-xs text-gray-500">Use the two-letter country code. This does not change the base currency or enable unsupported FX transactions.</p></div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" className="btn-secondary text-sm" disabled={submitting} onClick={() => setOpen(false)}>Cancel</button>
          <button type="submit" className="btn-primary text-sm" disabled={submitting || !isOnline}>{submitting ? "Creating..." : "Create"}</button>
        </div>
      </form>
    </Modal>
  </>;
}
