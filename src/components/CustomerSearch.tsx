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
    // If user clears the input, also clear the selection
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

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {selectedName ? (
        // Show selected customer as a chip with an × to clear
        <div className="input-field flex items-center justify-between gap-2 cursor-default">
          <span className="truncate text-gray-800">{selectedName}</span>
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
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder={placeholder}
          className="input-field w-full"
          autoComplete="off"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No customers found</div>
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
