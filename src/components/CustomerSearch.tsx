"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";

interface Props {
  value: number;           // selected customerId (0 = none)
  onChange: (id: number, name: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CustomerSearch({ value, onChange, placeholder = "Search customer…", className = "" }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // When value is cleared from outside (form reset), clear internal state
  useEffect(() => {
    if (!value) { setSelectedName(""); setQuery(""); }
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const WALKIN_ID = -1;
  const WALKIN_NAME = "Walk-in Customer";

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    const r = await apiCall("/api/v1/customers", { params: { search: q, limit: 10, is_active: "true" } });
    setLoading(false);
    if (r.success) { setResults(r.data as any[]); setOpen(true); }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (!q) { onChange(0, ""); setSelectedName(""); setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 250);
  };

  const select = (c: any) => {
    onChange(c.id, c.name);
    setSelectedName(c.name);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const selectWalkin = () => {
    onChange(WALKIN_ID, WALKIN_NAME);
    setSelectedName(WALKIN_NAME);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {selectedName ? (
        <div className={`input-field flex items-center justify-between gap-2 cursor-default ${value === WALKIN_ID ? "bg-orange-50 border-orange-200" : ""}`}>
          <span className="truncate text-gray-800">
            {value === WALKIN_ID && <span className="text-orange-600 mr-1.5">🚶</span>}
            {selectedName}
          </span>
          <button
            type="button"
            onClick={() => { onChange(0, ""); setSelectedName(""); setQuery(""); }}
            className="text-gray-400 hover:text-red-500 flex-shrink-0 text-base leading-none"
          >×</button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => { setOpen(true); }}
          placeholder={placeholder}
          className="input-field w-full"
          autoComplete="off"
        />
      )}

      {/* Dropdown */}
      {open && !selectedName && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {/* Walk-in option always at top */}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); selectWalkin(); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 flex items-center gap-2 border-b border-gray-100"
          >
            <span className="text-orange-500">🚶</span>
            <span className="font-medium text-orange-700">{WALKIN_NAME}</span>
          </button>
          {loading && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
          {!loading && query && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No customers found</div>
          )}
          {!query && !loading && (
            <div className="px-3 py-2 text-xs text-gray-400">Type to search customers…</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex flex-col"
            >
              <span className="font-medium text-gray-800">{c.name}</span>
              {c.phone && <span className="text-xs text-gray-400">{c.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
