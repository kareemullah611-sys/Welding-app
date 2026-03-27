"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import { ChevronRight, Users } from "lucide-react";

export default function InvestorsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [investors, setInvestors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiCall("/api/v1/investors", { params: { limit: 200 } });
    if (res.success) setInvestors(res.data as any[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user || user.role !== "super_admin") return null;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="pb-3 border-b border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900">Investors</h1>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : investors.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
          {investors.map(inv => {
            const capital = inv.accounts.reduce((s: number, a: any) => s + a.capital, 0);
            const sym = inv.accounts[0]?.currency?.symbol ?? "";
            return (
              <button
                key={inv.id}
                onClick={() => router.push(`/investors/${inv.id}`)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/70 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                  {inv.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{inv.name}</p>
                  {inv.relationship && (
                    <p className="text-xs text-gray-400">{inv.relationship}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 mr-1">
                  <p className="text-sm font-bold text-emerald-700">{sym} {formatNumber(capital)}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Balance</p>
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
