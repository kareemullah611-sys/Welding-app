"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import { Package, ChevronDown, ExternalLink } from "lucide-react";

type GodownSummary = {
  godownId: number;
  godownName: string;
  cityName?: string;
  totalQty: number;
};

export default function StockSummary({ totalCartonsSold }: { totalCartonsSold?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [godowns, setGodowns] = useState<GodownSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (loading || godowns.length > 0) return;
    setLoading(true);
    const r = await apiCall<{ godownsSummary?: GodownSummary[] }>("/api/v1/inventory");
    if (r.success && r.data) {
      setGodowns((r.data.godownsSummary || []).filter((g) => Number(g.totalQty) > 0));
    } else {
      setGodowns([]);
    }
    setLoading(false);
  }, [godowns.length, loading]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load]);

  const totalStock = godowns.reduce((sum, g) => sum + Number(g.totalQty || 0), 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-white p-2.5 text-amber-600 shadow-sm">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Stock</p>
          <p className="text-xl font-bold tabular-nums text-amber-700">
            {formatNumber(totalCartonsSold || 0)} cartons sold
          </p>
        </div>
        <ChevronDown
          className={`ml-auto h-5 w-5 text-gray-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading inventory…</p>
          ) : godowns.length === 0 ? (
            <p className="text-sm text-gray-500">No stock on hand in godowns.</p>
          ) : (
            <div className="space-y-2">
              {godowns.map((g) => (
                <div key={g.godownId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-800">{g.godownName}</span>
                  <span className="text-sm font-semibold tabular-nums text-amber-700">
                    {formatNumber(g.totalQty)} ctns
                  </span>
                </div>
              ))}
              <p className="pt-1 text-xs text-gray-500">
                On hand total: {formatNumber(totalStock)} cartons
              </p>
            </div>
          )}
          <Link
            href="/inventory"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
          >
            Open Inventory <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
