import ExcelJS from "exceljs";
import { apiCall } from "@/hooks/useApi";
import { formatLedgerMoneyAmount } from "@/lib/city-money-format";
import type { LotCostLedgerRow } from "@/lib/lot-cost-ledger";
import type { ExportPayload } from "@/lib/report-export-helpers";
import { formatExportDateShort, formatExportMetaDate } from "@/lib/report-export-helpers";
import type { SupplierLotStatementRow, SupplierRunningLedgerRow } from "@/lib/supplier-ledger";

export type LedgerExportType =
  | "sales"
  | "payments"
  | "expenses"
  | "withdrawals"
  | "customer_ledger"
  | "haji_transfers"
  | "ledger";

export type LedgerExportParams = {
  type: LedgerExportType;
  dateFrom?: string;
  dateTo?: string;
  cityId?: string | number;
  customerId?: string | number;
  ledgerType?: string;
  query?: string;
  status?: string;
  lotId?: string | number;
  format?: "xlsx" | "json";
};

export function buildLedgerExportParams(params: LedgerExportParams): Record<string, string> {
  const searchParams: Record<string, string> = {
    type: params.type,
    format: params.format || "xlsx",
  };
  if (params.dateFrom) searchParams.date_from = params.dateFrom;
  if (params.dateTo) searchParams.date_to = params.dateTo;
  if (params.cityId) searchParams.city_id = String(params.cityId);
  if (params.customerId) searchParams.customer_id = String(params.customerId);
  if (params.ledgerType && params.ledgerType !== "all") searchParams.ledger_type = params.ledgerType;
  if (params.query && params.query.trim().length >= 2) searchParams.q = params.query.trim();
  if (params.status) searchParams.status = params.status;
  if (params.lotId) searchParams.lot_id = String(params.lotId);
  return searchParams;
}

export function buildLedgerExportUrl(params: LedgerExportParams): string {
  const search = new URLSearchParams(buildLedgerExportParams(params));
  return `/api/v1/reports/export?${search.toString()}`;
}

export function openLedgerExport(params: LedgerExportParams) {
  window.open(buildLedgerExportUrl({ ...params, format: "xlsx" }), "_blank");
}

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Browsers print the page URL (and page numbers) in a header/footer strip only
// when the printed page reserves margin space for them. Setting @page margin to
// zero (after the template's own @page rule, so it wins the cascade) suppresses
// that strip, so customers no longer see the app's deployed URL on printed ledgers.
const PRINT_URL_SUPPRESSION_CSS = `
<style>
  @page { margin: 0; }
</style>
`;

export function injectPrintUrlSuppression(html: string): string {
  if (!html.includes("</head>")) return html;
  return html.replace("</head>", `${PRINT_URL_SUPPRESSION_CSS}</head>`);
}

function printHtmlDocument(html: string, title: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(injectPrintUrlSuppression(html));
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 2000);
  }, 200);
}

export function printLedgerExportPayload(payload: ExportPayload) {
  if (payload.reportType === "payments") {
    printPaymentsReportPayload(payload);
    return;
  }

  const metaParts = [
    `${payload.meta.dateFrom} — ${payload.meta.dateTo}`,
    payload.meta.city,
    payload.meta.search ? `Search: ${payload.meta.search}` : "",
    `Generated ${payload.meta.generatedAt}`,
  ].filter(Boolean);

  const rowsHtml = payload.rows.map((row, index) => `
    <tr class="${index % 2 === 1 ? "alt-row" : ""}">
      ${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
    </tr>
  `).join("");

  const html = `
    <html>
      <head>
        <title>${escapeHtml(payload.title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #222; padding: 24px; }
          h1 { margin: 0; font-size: 20px; }
          .meta { margin-top: 6px; color: #666; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border: 1px solid #e5e7eb; padding: 7px; text-align: left; font-size: 12px; vertical-align: top; overflow-wrap: anywhere; white-space: normal; }
          th { background: #f8fafc; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; color: #64748b; }
          .alt-row td { background: #f8fafc; }
          @page { margin: 12mm; size: A4 landscape; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(payload.title)}</h1>
        <div class="meta">${metaParts.map((part) => escapeHtml(part)).join(" · ")}</div>
        <table>
          <thead><tr>${payload.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
  printHtmlDocument(html, payload.title);
}

function printPaymentsReportPayload(payload: ExportPayload) {
  const { meta } = payload;
  const dateFrom = formatExportMetaDate(meta.dateFrom);
  const dateTo = formatExportMetaDate(meta.dateTo);
  const range =
    dateFrom === "All" && dateTo === "All"
      ? "All dates"
      : dateFrom === dateTo
        ? dateFrom
        : `${dateFrom} — ${dateTo}`;

  const metaParts = [
    range,
    meta.search ? `Search: ${meta.search}` : "",
    `Generated ${meta.generatedAt}`,
  ].filter(Boolean);

  const titleLine =
    meta.city !== "All Cities"
      ? `Payments Report — ${meta.city}`
      : payload.title;

  const rowsHtml = payload.rows.map((row, index) => `
    <tr class="${index % 2 === 1 ? "alt-row" : ""}">
      <td class="col-date">${escapeHtml(row[0])}</td>
      <td class="col-customer">${escapeHtml(row[1])}</td>
      <td class="col-particulars">${escapeHtml(row[2])}</td>
      <td class="col-ref">${escapeHtml(row[3])}</td>
      <td class="col-amount">${escapeHtml(row[4])}</td>
      <td class="col-dest">${escapeHtml(row[5])}</td>
      <td class="col-status">${escapeHtml(row[6])}</td>
    </tr>
  `).join("");

  const html = `
    <html>
      <head>
        <title>${escapeHtml(titleLine)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #222; padding: 20px; }
          h1 { margin: 0; font-size: 17px; font-weight: 700; }
          .meta { margin-top: 5px; color: #666; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
          th, td { border: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; font-size: 11px; vertical-align: top; overflow-wrap: anywhere; }
          th { background: #f8fafc; text-transform: uppercase; letter-spacing: .05em; font-size: 9px; color: #64748b; }
          .alt-row td { background: #f8fafc; }
          .col-date { width: 6.5em; white-space: nowrap; }
          .col-customer { width: 11em; }
          .col-particulars { width: auto; }
          .col-amount { width: 8.5em; text-align: right; white-space: nowrap; }
          .col-dest { width: 8em; }
          .col-ref { width: 4.5em; white-space: nowrap; }
          .col-status { width: 5.5em; }
          @page { margin: 10mm; size: A4 landscape; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(titleLine)}</h1>
        <div class="meta">${metaParts.map((part) => escapeHtml(part)).join(" · ")}</div>
        <table>
          <thead>
            <tr>
              <th class="col-date">Date</th>
              <th class="col-customer">Customer</th>
              <th class="col-particulars">Particulars</th>
              <th class="col-ref">Ref. No.</th>
              <th class="col-amount">Amount</th>
              <th class="col-dest">Destination</th>
              <th class="col-status">Status</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
  printHtmlDocument(html, titleLine);
}

export async function fetchLedgerExportPayload(params: LedgerExportParams): Promise<ExportPayload | null> {
  const result = await apiCall<ExportPayload>("/api/v1/reports/export", {
    params: buildLedgerExportParams({ ...params, format: "json" }),
  });
  if (!result.success || !result.data) return null;
  return result.data as ExportPayload;
}

export async function printLedgerExport(params: LedgerExportParams) {
  const payload = await fetchLedgerExportPayload(params);
  if (!payload) return false;
  printLedgerExportPayload(payload);
  return true;
}

export function printCustomerLedgerStatement(options: {
  customerName: string;
  ledger: any[];
  balanceSummary?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
}) {
  const { customerName, ledger, balanceSummary, dateFrom, dateTo, query } = options;
  const range =
    dateFrom && dateTo ? `${dateFrom} — ${dateTo}` :
    dateFrom ? `From ${dateFrom}` :
    dateTo ? `Until ${dateTo}` :
    "All dates";

  const needle = String(query || "").trim().toLowerCase();
  const visibleLedger = needle.length >= 2
    ? (ledger || []).filter((entry) =>
        [entry.date, entry.type, entry.currency, entry.detail, entry.voucherNo, entry.status]
          .some((value) => String(value ?? "").toLowerCase().includes(needle)),
      )
    : (ledger || []);

  const rowsHtml = visibleLedger.map((entry, index) => {
    const sym = String(entry.currencySymbol || entry.currency || "").trim();
    return `
    <tr class="${index % 2 === 1 ? "alt-row" : ""}${entry.status === "cancelled" ? " cancelled" : ""}">
      <td>${escapeHtml(formatExportDateShort(entry.date))}</td>
      <td>${escapeHtml(entry.type === "sale" ? `Sale · ${entry.detail || entry.voucherNo || ""}` : entry.type === "opening" ? entry.detail || "Opening" : entry.detail || entry.voucherNo || "Receipt")}</td>
      <td class="debit">${entry.debit > 0 ? escapeHtml(formatLedgerMoneyAmount(Number(entry.debit), sym, entry.currency)) : "—"}</td>
      <td class="credit">${entry.credit > 0 ? escapeHtml(formatLedgerMoneyAmount(Number(entry.credit), sym, entry.currency)) : "—"}</td>
      <td class="balance">${typeof entry.balance === "number" && !Number.isNaN(entry.balance) ? escapeHtml(formatLedgerMoneyAmount(Number(entry.balance), sym, entry.currency)) : "—"}</td>
    </tr>
  `;
  }).join("");

  const html = `
    <html>
      <head>
        <title>Customer Ledger — ${escapeHtml(customerName)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #222; padding: 24px; }
          h1 { margin: 0; font-size: 20px; }
          .meta { margin-top: 6px; color: #666; font-size: 12px; }
          .summary { margin-top: 10px; font-size: 13px; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border: 1px solid #e5e7eb; padding: 7px; text-align: left; font-size: 12px; vertical-align: top; overflow-wrap: anywhere; white-space: normal; }
          th { background: #f8fafc; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; color: #64748b; }
          .alt-row td { background: #f8fafc; }
          .cancelled td { opacity: 0.55; text-decoration: line-through; }
          .debit, .credit, .balance { text-align: right; }
          .debit { color: #991b1b; font-weight: 700; }
          .credit { color: #166534; font-weight: 700; }
          @page { margin: 12mm; size: A4 landscape; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(customerName)}</h1>
        <div class="meta">${escapeHtml(range)}${needle ? ` · Search: ${escapeHtml(needle)}` : ""} · Generated ${escapeHtml(new Date().toLocaleString())}</div>
        ${balanceSummary ? `<div class="summary">${escapeHtml(balanceSummary)}</div>` : ""}
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Detail</th>
              <th>Debit</th><th>Credit</th><th>Balance</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
  printHtmlDocument(html, `Customer Ledger — ${customerName}`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function writeWorkbookSheets(sheets: Array<{ name: string; rows: unknown[][] }>, filename: string) {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRows(sheet.rows.map((row) => row.map((value) => value ?? "")));
  }
  const wbout = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}

export async function exportLotCostLedgerXlsx(input: {
  lotNumber: string;
  lotDate?: string;
  countryName?: string;
  rows: LotCostLedgerRow[];
  totalLandedCostPkr?: number | null;
}) {
  const rows: unknown[][] = [
    ["Lot Cost Ledger", input.lotNumber],
    ["Lot Date", input.lotDate || ""],
    ["Country", input.countryName || ""],
    ["Generated", new Date().toISOString().split("T")[0]],
    [],
    ["Date", "Particulars", "Amount", "Currency", "Rate→PKR", "PKR", "Pay From", "Running PKR"],
  ];

  for (const r of input.rows) {
    rows.push([
      formatExportDateShort(r.date),
      r.particulars,
      r.amount,
      r.currencyCode,
      r.acquisitionRateToPkr ?? "",
      r.amountPkr,
      r.payFromLabel,
      r.runningPkr,
    ]);
  }

  if (input.totalLandedCostPkr != null) {
    rows.push([]);
    rows.push(["", "", "", "", "", "", "Total landed (PKR)", input.totalLandedCostPkr]);
  }

  writeWorkbookSheets(
    [{ name: "Cost Ledger", rows }],
    `lot_cost_ledger_${input.lotNumber.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
}

export function exportLotCostLedgerPdf(input: {
  lotNumber: string;
  lotDate?: string;
  countryName?: string;
  rows: LotCostLedgerRow[];
  totalLandedCostPkr?: number | null;
}) {
  const tableRows = input.rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatExportDateShort(r.date))}</td>
        <td>${escapeHtml(r.particulars)}</td>
        <td style="text-align:right;">${Number(r.amount).toLocaleString("en-US")}</td>
        <td>${escapeHtml(r.currencyCode)}</td>
        <td style="text-align:right;">${r.acquisitionRateToPkr ? Number(r.acquisitionRateToPkr).toLocaleString("en-US") : "—"}</td>
        <td style="text-align:right;">${r.amountPkr > 0 ? `Rs ${Math.round(r.amountPkr).toLocaleString("en-US")}` : "—"}</td>
        <td>${escapeHtml(r.payFromLabel)}</td>
        <td style="text-align:right;">${r.runningPkr > 0 ? `Rs ${Math.round(r.runningPkr).toLocaleString("en-US")}` : "—"}</td>
      </tr>`,
    )
    .join("");

  const html = `
    <html>
      <head>
        <title>Lot Cost Ledger ${escapeHtml(input.lotNumber)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
          h1 { margin: 0 0 8px 0; font-size: 20px; }
          .meta { margin: 0 0 16px 0; font-size: 13px; color: #555; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #e4e4e4; padding: 7px; font-size: 12px; text-align: left; }
          th { background: #f6f6f6; text-transform: uppercase; font-size: 10px; letter-spacing: .07em; color: #666; }
        </style>
      </head>
      <body>
        <h1>Lot Cost Ledger — ${escapeHtml(input.lotNumber)}</h1>
        <p class="meta">${escapeHtml(input.lotDate || "")} · ${escapeHtml(input.countryName || "")}</p>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Particulars</th><th>Amount</th><th>Currency</th>
              <th>Rate→PKR</th><th>PKR</th><th>Pay From</th><th>Running PKR</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${
          input.totalLandedCostPkr != null
            ? `<p style="margin-top:16px;font-weight:700;">Total landed cost: Rs ${Math.round(input.totalLandedCostPkr).toLocaleString("en-US")}</p>`
            : ""
        }
      </body>
    </html>`;

  printHtmlDocument(html, `Lot Cost Ledger ${input.lotNumber}`);
}

export async function exportSupplierLedgerXlsx(input: {
  supplierName: string;
  statement: SupplierLotStatementRow[];
  runningLedger: SupplierRunningLedgerRow[];
}) {
  const statementRows: unknown[][] = [
    ["Supplier Ledger", input.supplierName],
    ["Generated", new Date().toISOString().split("T")[0]],
    [],
    ["Lot-wise Statement"],
    ["#", "Invoice", "Country", "Order Details", "Qty (Tons)", "Amount (USD)", "Deposit (USD)", "Remaining (USD)", "Running Balance (USD)", "Status"],
  ];

  for (const row of input.statement) {
    statementRows.push([
      row.itemNo,
      row.invoiceNumber,
      row.marketCountry,
      row.orderDetails,
      row.quantityTons,
      row.amountUsd,
      row.depositUsd,
      row.lotBalanceUsd,
      row.runningBalanceUsd,
      row.status === "settled" ? "Settled" : "Pending",
    ]);
  }

  const runningRows: unknown[][] = [
    ["Running Balance"],
    ["Date", "Particulars", "Debit (USD)", "Credit (USD)", "Balance (USD)"],
  ];

  for (const entry of input.runningLedger) {
    runningRows.push([
      formatExportDateShort(entry.date),
      entry.particulars,
      entry.debitUsd || "",
      entry.creditUsd || "",
      entry.balanceUsd,
    ]);
  }

  writeWorkbookSheets(
    [
      { name: "Statement", rows: statementRows },
      { name: "Running Balance", rows: runningRows },
    ],
    `supplier_ledger_${String(input.supplierName).replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
}
