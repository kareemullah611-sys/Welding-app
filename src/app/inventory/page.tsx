"use client";

import React, { useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function InventoryPage() {
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadInventory(); }, []);

  const loadInventory = async () => {
    setLoading(true);
    const result = await apiCall("/api/v1/inventory");
    if (result.success) setData(result.data);
    setLoading(false);
  };

  if (loading || !data) {
    return (
      <div>
        <PageHeader title={t("inventory")} subtitle={t("complete_stock_overview")} />
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("inventory")} subtitle={t("complete_stock_overview")} />

      {/* Grand Total */}
      <div className="card mb-6 text-center">
        <p className="text-sm text-gray-500">{t("grand_total")}</p>
        <p className="text-4xl font-bold text-primary-600 mt-1">{formatNumber(data.grandTotalQty)}</p>
        <p className="text-xs text-gray-400 mt-1">{t("cartons_across_godowns")}</p>
      </div>

      {/* Product-wise Summary */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("stock_by_product")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.productsSummary?.map((p: any) => (
            <div key={p.productId} className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700 truncate">{p.productName}</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(p.totalQty)}</p>
            </div>
          ))}
          {(!data.productsSummary || data.productsSummary.length === 0) && (
            <p className="text-sm text-gray-400 col-span-full">{t("no_stock_data")}</p>
          )}
        </div>
      </div>

      {/* Godown-wise Summary */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("stock_by_godown")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.godownsSummary?.map((g: any) => (
            <div key={g.godownId} className="bg-blue-50 rounded-lg p-3">
              <p className="text-sm font-medium text-blue-700 truncate">{g.godownName}</p>
              <p className="text-xs text-blue-500">{g.cityName}</p>
              <p className="text-xl font-bold text-blue-900 mt-1">{formatNumber(g.totalQty)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("detailed_product_godown")}</h2>
        {data.detailed?.map((godown: any) => (
          <div key={godown.godownId} className="border border-gray-200 rounded-lg overflow-hidden mb-3">
            <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900">{godown.godownName}</span>
                <span className="text-xs text-gray-500 ml-2">({godown.cityName})</span>
              </div>
              <span className="text-sm font-bold text-gray-700">{formatNumber(godown.totalQty)} {t("total")}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {godown.products.map((p: any) => (
                <div key={p.productId} className="px-4 py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{p.productName}</span>
                  <span className={`font-medium ${p.qty <= 0 ? "text-red-600" : "text-gray-900"}`}>
                    {formatNumber(p.qty)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
