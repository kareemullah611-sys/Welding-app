"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiCall } from "@/hooks/useApi";

type Props = {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  labelClassName?: string;
};

export default function WithdraweeFieldWithNew({
  value,
  onChange,
  placeholder = "Search existing names",
  label = "Withdrawn By",
  required = true,
  labelClassName = "block text-sm font-medium text-gray-700",
}: Props) {
  const [options, setOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!value) { setSearch(""); return; }
    setSearch(value);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    apiCall("/api/v1/personal-withdrawals/names").then((res) => {
      if (!cancelled && res.success) setOptions((res.data as string[]) || []);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");
  const q = normalizeName(search).toLowerCase();
  const filtered = options.filter((n) => n.toLowerCase().includes(q));

  const select = (name: string) => {
    const normalized = normalizeName(name);
    onChange(normalized);
    setSearch(normalized);
    setOpen(false);
  };

  const handleNew = async () => {
    const name = normalizeName(newName);
    if (!name) { setFormError("Name required"); return; }
    setCreating(true);
    setFormError("");
    try {
      const res = await apiCall("/api/v1/personal-withdrawals/names", {
        method: "POST",
        body: { name },
      });
      if (res.success) {
        setOptions((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))));
        onChange(name);
        setNewName("");
        setFormError("");
        setShowNew(false);
        setOpen(false);
      } else {
        setFormError(res.error || "Failed to save withdrawee name");
      }
    } catch {
      setFormError("Failed to save withdrawee name");
    } finally {
      setCreating(false);
    }
  };

  const resetNew = () => { setNewName(""); setFormError(""); setShowNew(false); };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className={labelClassName}>
          {label}{required ? " *" : ""}
        </label>
        {!showNew && (
          <button
            type="button"
            onClick={() => { setFormError(""); setShowNew(true); }}
            className="shrink-0 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline"
          >
            + New
          </button>
        )}
      </div>

      {showNew && (
        <div className="mb-2 space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
          {formError && <p className="text-xs text-red-600">{formError}</p>}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input-field"
            placeholder="Withdrawee name"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Escape") resetNew(); }}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleNew()} disabled={creating} className="btn-primary flex-1 text-sm" data-form-submit="true">{creating ? "Saving..." : "Create"}</button>
            <button type="button" onClick={resetNew} disabled={creating} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {!showNew && (
        <div className="relative min-w-0" ref={menuRef}>
          <input
            value={search}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(v);
              onChange(v);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="input-field"
            placeholder={placeholder}
          />
          {open && (
            <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="max-h-48 overflow-y-auto py-1">
                {filtered.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); select(name); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {name}
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500">No matching name found</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
