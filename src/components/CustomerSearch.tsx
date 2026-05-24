"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search } from "lucide-react";
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
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

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
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const r = await apiCall("/api/v1/customers", { params: { search: q, limit: 10, is_active: "true" } });
    setLoading(false);
    if (r.success) {
      const list = r.data as any[];
      setResults(list);
      setActiveIndex(list.length > 0 ? 1 : 0);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (value && q !== selectedName) {
      onChange(0, "");
      setSelectedName("");
    }
    if (!q.trim()) {
      onChange(0, "");
      setSelectedName("");
      setResults([]);
      setActiveIndex(0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 250);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const optionsCount = 1 + results.length; // walk-in + search results
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev + 1 + optionsCount) % optionsCount);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev - 1 + optionsCount) % optionsCount);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!open) return;
      if (activeIndex <= 0) {
        selectWalkin();
      } else {
        const picked = results[activeIndex - 1];
        if (picked) select(picked);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const select = (c: any) => {
    onChange(c.id, c.name);
    setSelectedName(c.name);
    setQuery("");
    setResults([]);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const selectWalkin = () => {
    onChange(WALKIN_ID, WALKIN_NAME);
    setSelectedName(WALKIN_NAME);
    setQuery("");
    setResults([]);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleFocus = () => {
    setFocused(true);
    setOpen(true);
    if (value) {
      setQuery(selectedName);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      if (wrapperRef.current?.contains(document.activeElement)) return;
      setOpen(false);
      setFocused(false);
      if (value) setQuery("");
    }, 120);
  };

  const hasSelection = value !== 0;
  const inputValue = focused || !hasSelection ? query : selectedName;
  const showDropdown = open && (focused || !hasSelection || query.length > 0);
  const isWalkin = value === WALKIN_ID;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInput}
          onKeyDown={handleInputKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={`input-field w-full pr-10 ${
            hasSelection && !focused
              ? isWalkin
                ? "bg-orange-50 border-orange-200 text-orange-900"
                : "bg-primary-50/40 border-primary-200 text-gray-900"
              : ""
          }`}
          autoComplete="off"
          data-modal-nav="local"
        />
        <Search
          className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
            hasSelection && !focused ? "text-primary-500/70" : "text-gray-400"
          }`}
          aria-hidden
        />
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); selectWalkin(); }}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-gray-100 ${activeIndex === 0 ? "bg-orange-50" : "hover:bg-orange-50"}`}
          >
            <span className="text-orange-500">🚶</span>
            <span className="font-medium text-orange-700">{WALKIN_NAME}</span>
          </button>
          {loading && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
          {!loading && query && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No customers found</div>
          )}
          {!loading && !query && (
            <div className="px-3 py-2 text-xs text-gray-400">
              {hasSelection && focused ? "Type to search for a different customer…" : "Type to search customers…"}
            </div>
          )}
          {results.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              className={`w-full text-left px-3 py-2 text-sm flex flex-col ${activeIndex === idx + 1 ? "bg-primary-50" : "hover:bg-primary-50"}`}
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
