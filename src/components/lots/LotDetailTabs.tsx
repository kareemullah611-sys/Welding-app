"use client";
import React from "react";
import { Modal, StatsCard, formatNumber, formatDate, StatusBadge } from "@/components/ui";
import { Download, FileText, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { formatCityAmount, formatCityPot } from "@/lib/city-money-format";
import { lotShipmentStatusLabel } from "@/lib/lot-documents";

type Props = {
  selectedLot: any;
  userRole?: string;
  t: (key: string) => string;
  onAddCost: () => void;
  onEditPurchase: (item: any) => void;
  onDeletePurchase: (item: any) => void;
  onAddDocument?: () => void;
  onChangeStatus?: () => void;
  onArchiveDocument?: (document: any) => void;
  onEditExchangeRate?: () => void;
};

function exchangeRateSourceLabel(metadata: any) {
  const provider = String(metadata?.provider || "").toUpperCase();
  if (provider === "SBP") return "SBP";
  if (provider === "SARAFI_AF") return "Sarai Shahzada";
  if (provider === "ACTUAL_DOCUMENTED_TRANSACTION_RATE") return "Supplier Payment";
  if (provider.includes("MANUAL")) return "Manual";
  return metadata ? "Recorded" : "—";
}

export function LotDetailSummary({ selectedLot, userRole, t, onAddCost, onEditPurchase, onDeletePurchase, onAddDocument, onChangeStatus, onArchiveDocument, onEditExchangeRate }: Props) {
  const [previewDocument, setPreviewDocument] = React.useState<any>(null);
  const purchaseUsd = Number(selectedLot.costSummary?.totalPurchaseUsd || 0);
  const otherByCurrency = selectedLot.costSummary?.otherCostsByCurrency || selectedLot.costSummary?.costsByCurrency || {};
  const landedPkr = selectedLot.costSummary?.totalLandedCostPkr;
  const canPreviewDocument = previewDocument && (
    String(previewDocument.mimeType || "").startsWith("image/")
    || previewDocument.mimeType === "application/pdf"
    || previewDocument.mimeType === "text/csv"
  );

  const downloadDocument = (document: any) => {
    const link = window.document.createElement("a");
    link.href = document.downloadUrl;
    link.download = document.originalFileName || "lot-document";
    link.rel = "noreferrer";
    window.document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatsCard title="Purchase (USD)" value={`$${formatNumber(purchaseUsd)}`} icon="P" color="blue" />
        <StatsCard title="Landed cost (PKR)" value={landedPkr != null ? `Rs ${formatNumber(Math.round(landedPkr))}` : "—"} icon="L" color="green" />
        <StatsCard title="Total Cartons" value={formatNumber(selectedLot.stockSummary?.totalCartons || 0)} icon="T" color="blue" />
        <StatsCard title="Sold Cartons" value={formatNumber(selectedLot.stockSummary?.soldCartons || 0)} icon="S" color="green" />
        <StatsCard title="Remaining" value={formatNumber(selectedLot.stockSummary?.remainingCartons || 0)} icon="R" color="yellow" />
      </div>

      {Object.keys(otherByCurrency).length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(otherByCurrency).map(([code, amt]) => (
          <StatsCard key={code} title={`Costs (${code})`} value={formatNumber(Number(amt))} icon="C" color="yellow" />
        ))}
        </div>
      )}

      {userRole === "super_admin" && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onAddCost} className="btn-primary text-sm">+ Add Cost</button>
          <button onClick={onAddDocument} className="btn-secondary text-sm">Add Document</button>
          <button onClick={onChangeStatus} className="btn-secondary text-sm">Change Status</button>
          <a href={`/sales?lotId=${selectedLot.id}`} className="text-sm text-primary-600 hover:underline">View sales for this lot</a>
        </div>
      )}

      {userRole === "super_admin" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Consignee</p>
            <p className="mt-1 text-sm font-semibold text-gray-800">{selectedLot.consignee?.name || "—"}</p>
            {selectedLot.consignee?.phone && <p className="mt-1 text-xs text-gray-500">{selectedLot.consignee.phone}</p>}
          </div>
          <div className="card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Status</p>
            <p className="mt-1 text-sm font-semibold text-blue-700">{selectedLot.shipmentStatusLabel || lotShipmentStatusLabel(selectedLot.shipmentStatus)}</p>
            {selectedLot.destinationCity?.name && <p className="mt-1 text-xs text-gray-500">Destination: {selectedLot.destinationCity.name}</p>}
            {selectedLot.etaDate && <p className="mt-1 text-xs text-gray-500">ETA: {formatDate(selectedLot.etaDate)}</p>}
          </div>
          <div className="card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Documents</p>
            <p className="mt-1 text-sm font-semibold text-gray-800">{Number(selectedLot.documentsCount || selectedLot.documents?.length || 0)} saved</p>
          </div>
          <div className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Exchange Rate</p>
                <p className="mt-1 text-sm font-semibold text-gray-800">{selectedLot.pkrExchangeRate ? `PKR ${Number(selectedLot.pkrExchangeRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/USD` : "—"}</p>
                <p className="mt-1 text-xs text-gray-500">Source: {exchangeRateSourceLabel(selectedLot.pkrExchangeRateMetadata)}</p>
              </div>
              {onEditExchangeRate && <button type="button" onClick={onEditExchangeRate} className="text-xs font-semibold text-primary-700 hover:underline">Edit</button>}
            </div>
          </div>
        </div>
      )}

      {userRole === "super_admin" && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-700">Documents</h4>
            <button onClick={onAddDocument} className="text-sm font-semibold text-primary-700 hover:underline">Add Document</button>
          </div>
          {(selectedLot.documents || []).length ? (
            <div className="space-y-2">
              {selectedLot.documents.map((doc: any) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#eadfce] bg-white px-3 py-2 text-sm">
                  <div>
                    <button type="button" onClick={() => setPreviewDocument(doc)} className="font-semibold text-primary-700 hover:underline">{doc.originalFileName}</button>
                    <p className="text-xs text-gray-500">{doc.categoryLabel || doc.category}{doc.referenceNo ? ` · Ref ${doc.referenceNo}` : ""}{doc.documentDate ? ` · ${formatDate(doc.documentDate)}` : ""}</p>
                  </div>
                  {onArchiveDocument && <button onClick={() => onArchiveDocument(doc)} className="text-xs font-semibold text-red-600 hover:underline">Archive</button>}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No documents saved yet.</p>}
        </div>
      )}

      {userRole === "super_admin" && (
        <div className="card">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Status Timeline</h4>
          {(selectedLot.statusHistory || []).length ? (
            <div className="space-y-2">
              {selectedLot.statusHistory.map((row: any) => (
                <div key={row.id} className="rounded-xl border border-[#eadfce] bg-white px-3 py-2 text-sm">
                  <p className="font-semibold text-gray-800">{row.newStatusLabel || lotShipmentStatusLabel(row.newStatus)}</p>
                  <p className="text-xs text-gray-500">{formatDate(row.effectiveAt)}{row.location ? ` · ${row.location}` : ""}{row.changedBy?.fullName ? ` · ${row.changedBy.fullName}` : ""}</p>
                  {row.note && <p className="mt-1 text-xs text-gray-600">{row.note}</p>}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No status changes recorded yet.</p>}
        </div>
      )}

      <Modal
        open={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
        title={previewDocument?.originalFileName || "Document preview"}
        size="xl"
        bodyClassName="p-0"
      >
        <div className="flex min-h-[60vh] flex-col bg-[#f5f1eb]">
          <div className="flex items-center justify-between gap-3 border-b border-[#e7ded2] bg-white px-4 py-3">
            <p className="truncate text-sm text-gray-600">{previewDocument?.categoryLabel || previewDocument?.category || "Document"}</p>
            <button type="button" onClick={() => downloadDocument(previewDocument)} className="btn-secondary inline-flex shrink-0 items-center gap-2 text-sm">
              <Download size={15} /> Download
            </button>
          </div>
          {canPreviewDocument ? (
            <iframe
              src={`${previewDocument?.downloadUrl}?preview=1`}
              title={previewDocument?.originalFileName || "Document preview"}
              className="h-[70vh] w-full flex-1 border-0 bg-white"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <FileText size={42} className="mb-4 text-[#9a8068]" />
              <p className="font-semibold text-gray-800">Preview is not available for this file format.</p>
              <p className="mt-1 text-sm text-gray-500">Download the document to open it in its supported application.</p>
            </div>
          )}
        </div>
      </Modal>

      {(selectedLot.purchaseItems?.length > 0) && (
        <div className="card">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Purchase (USD)</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[#eadfce] bg-[#f9f3ea] text-left text-[11px] uppercase tracking-[0.12em] text-[#8b7b6c]">
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5 text-right">Qty (MT/CTN)</th>
                  <th className="px-3 py-2.5 text-right">Amount USD</th>
                  {userRole === "super_admin" && <th className="px-3 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {selectedLot.purchaseItems.map((p: any) => {
                  const piecesPerCarton = Number(p.piecesPerCarton || 0);
                  const displayPurchaseQty = p.unitOfMeasure === "PCS" && piecesPerCarton > 0
                    ? Number(p.qtyPcs || 0) / piecesPerCarton
                    : Number(p.qtyMt || 0);
                  return (
                    <tr key={p.id} className="border-b border-[#f1e8dd]">
                      <td className="px-3 py-2.5">{p.productName}</td>
                      <td className="px-3 py-2.5 text-right">{displayPurchaseQty.toLocaleString("en-US", { minimumFractionDigits: 3 })}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-blue-700">${Number(p.totalPriceUsd).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      {userRole === "super_admin" && (
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={() => onEditPurchase(p)} className="p-1 text-gray-400 hover:text-blue-600" title="Edit"><Pencil size={12} /></button>
                          <button onClick={() => onDeletePurchase(p)} className="ml-1 p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 size={12} /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(selectedLot.products || []).length > 0 && (
        <div className="card">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Stock by Product</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#eadfce] bg-[#f9f3ea] text-left text-[11px] uppercase tracking-[0.12em] text-[#8b7b6c]">
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Sold</th>
                  <th className="px-3 py-2.5 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {(selectedLot.stockSummary?.byProduct || selectedLot.products || []).map((p: any) => {
                  const totalQty = Number(p.displayTotalQty ?? p.displayAssignedQty ?? p.totalQty ?? p.assignedQty ?? 0);
                  const soldQty = Number(p.displaySoldQty ?? p.soldQty ?? 0);
                  const remainingQty = Number(p.displayRemainingQty ?? p.remainingQty ?? 0);
                  return (
                    <tr key={p.productId} className="border-b border-[#f1e8dd]">
                      <td className="px-3 py-2.5">{p.productName}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(totalQty)}</td>
                      <td className="px-3 py-2.5 text-right text-green-700">{formatNumber(soldQty)}</td>
                      <td className="px-3 py-2.5 text-right text-blue-700">{formatNumber(remainingQty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export function LotDetailLedger({ selectedLot, userRole }: { selectedLot: any; userRole?: string }) {
  const rows = selectedLot.costLedger || [];

  if (userRole !== "super_admin") {
    return <div className="card text-sm text-gray-500">Cost ledger is available for super admin only.</div>;
  }

  if (!rows.length) {
    return <div className="card text-sm text-gray-400">No ledger entries yet.</div>;
  }

  return (
    <div className="card">
      <h4 className="mb-3 text-sm font-semibold text-gray-700">Cost Ledger</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[#eadfce] bg-[#f9f3ea] text-left text-[11px] uppercase tracking-[0.12em] text-[#8b7b6c]">
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Particulars</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5">Currency</th>
              <th className="px-3 py-2.5 text-right">Rate→PKR</th>
              <th className="px-3 py-2.5 text-right">PKR</th>
              <th className="px-3 py-2.5">Pay from</th>
              <th className="px-3 py-2.5 text-right">Running PKR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={`${r.sourceType}-${r.sourceId}-${i}`} className="border-b border-[#f1e8dd]">
                <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="px-3 py-2.5 text-gray-700">{r.particulars}</td>
                <td className="px-3 py-2.5 text-right font-medium">{Number(r.amount).toLocaleString("en-US")}</td>
                <td className="px-3 py-2.5">{r.currencyCode}</td>
                <td className="px-3 py-2.5 text-right text-gray-500">{r.acquisitionRateToPkr ? Number(r.acquisitionRateToPkr).toLocaleString("en-US") : "—"}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{r.amountPkr > 0 ? `Rs ${formatNumber(Math.round(r.amountPkr))}` : "—"}</td>
                <td className="px-3 py-2.5 text-xs text-gray-600">{r.payFromLabel}</td>
                <td className="px-3 py-2.5 text-right font-medium">{r.runningPkr > 0 ? `Rs ${formatNumber(Math.round(r.runningPkr))}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CityLotAssignmentDetail({ selectedLot, t }: { selectedLot: any; t: (key: string) => string }) {
  const { user } = useAuth();
  const byProduct = selectedLot.stockSummary?.byProduct || [];
  const soldSalesByCurrency = selectedLot.stockSummary?.soldSalesByCurrency || {};
  const soldSalesLabel = formatCityPot(user, soldSalesByCurrency);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#e9dccb] bg-[linear-gradient(135deg,rgba(255,248,239,0.95),rgba(245,233,219,0.84))] p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f7963]">Your assignment</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("lot")}</p>
            <p className="mt-1 text-sm font-semibold text-[#2f241b]">{selectedLot.lotNumber}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("date")}</p>
            <p className="mt-1 text-sm font-semibold text-[#2f241b]">{formatDate(selectedLot.lotDate)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("status")}</p>
            <div className="mt-1"><StatusBadge status={selectedLot.status} /></div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#8f7963]">{t("sold")}</p>
            <p className="mt-1 text-sm font-semibold text-green-700">
              {formatNumber(selectedLot.stockSummary?.soldCartons || 0)} {t("cartons")}
            </p>
            {soldSalesLabel !== "0" && (
              <p className="text-xs text-[#6f5f50]">{soldSalesLabel}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard title="Assigned Cartons" value={formatNumber(selectedLot.stockSummary?.totalCartons || 0)} icon="A" color="blue" />
        <StatsCard title="Sold Cartons" value={formatNumber(selectedLot.stockSummary?.soldCartons || 0)} icon="S" color="green" />
        <StatsCard title="Sold Amount" value={soldSalesLabel} icon="₨" color="green" />
        <StatsCard title="Remaining" value={formatNumber(selectedLot.stockSummary?.remainingCartons || 0)} icon="R" color="yellow" />
      </div>

      <a href={`/sales?lotId=${selectedLot.id}`} className="inline-block text-sm text-primary-600 hover:underline">View sales for this lot</a>

      {byProduct.length > 0 && (
        <div className="card">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Assigned goods</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#eadfce] bg-[#f9f3ea] text-left text-[11px] uppercase tracking-[0.12em] text-[#8b7b6c]">
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5 text-right">Assigned</th>
                  <th className="px-3 py-2.5 text-right">Sold</th>
                  <th className="px-3 py-2.5 text-right">Sold Amount</th>
                  <th className="px-3 py-2.5 text-right">Remaining</th>
                  <th className="px-3 py-2.5">Godowns</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map((p: any) => {
                  const assignedQty = Number(p.displayAssignedQty ?? p.assignedQty ?? 0);
                  const soldQty = Number(p.displaySoldQty ?? p.soldQty ?? 0);
                  const remainingQty = Number(p.displayRemainingQty ?? p.remainingQty ?? 0);
                  return (
                    <tr key={p.productId} className="border-b border-[#f1e8dd]">
                      <td className="px-3 py-2.5 font-medium">{p.productName}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(assignedQty)}</td>
                      <td className="px-3 py-2.5 text-right text-green-700">{formatNumber(soldQty)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-green-800">
                        {formatCityAmount(user, Number(p.soldAmount || 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right text-blue-700">{formatNumber(remainingQty)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">
                        {(p.godownAllocations || []).length
                          ? (p.godownAllocations || []).map((g: any) => `${g.godownName}: ${formatNumber(g.displayQty ?? g.qty)}`).join(" · ")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
