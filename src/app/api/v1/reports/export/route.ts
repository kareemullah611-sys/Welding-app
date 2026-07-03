import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";
import { successResponse } from "@/lib/api-response";
import ExcelJS from "exceljs";
import {
  appendExportMetaRows,
  buildExportDateFilter,
  buildExportMeta,
  buildExpenseExportSearchWhere,
  buildPaymentExportSearchWhere,
  fmtReportMoney,
  matchesExportTextSearch,
  parseExportSearchQuery,
  formatExportDateShort,
  type ExportPayload,
} from "@/lib/report-export-helpers";
import { formatCustomerLedgerPaymentDetail } from "@/lib/customer-ledger-detail";

const fmtAmount = (value: number | string) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return Math.round(numeric * 100) / 100;
};
const fmtAmountCsv = (value: number | string) => {
  const numeric = fmtAmount(value);
  return Number(numeric).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const formatPerCartonRate = (rates: number[]) => {
  if (!rates.length) return "-";
  const uniqueRates = Array.from(new Set(rates.map((value) => Math.round(value * 100) / 100))).sort((a, b) => a - b);
  if (uniqueRates.length === 1) return uniqueRates[0].toLocaleString("en-US");
  const min = uniqueRates[0].toLocaleString("en-US");
  const max = uniqueRates[uniqueRates.length - 1].toLocaleString("en-US");
  return `${min} - ${max}`;
};

const formatStatus = (status: string) =>
  status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const formatLabel = (value: unknown) =>
  String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
const cleanText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const formatDate = (date: Date) => formatExportDateShort(date);

function parseStatusFilter(statusParam: string | null) {
  const statusValues = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!statusValues.length) return undefined;
  if (statusValues.length === 1) return statusValues[0];
  return { in: statusValues };
}

// GET /api/v1/reports/export?type=sales|payments|expenses|ledger|haji_transfers|customer_ledger
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") || "sales";
    const format = searchParams.get("format") || "xlsx";
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const cityFilter = cityId ? { cityId } : {};
    const search = parseExportSearchQuery(searchParams.get("q"));
    const statusFilter = parseStatusFilter(searchParams.get("status"));
    const city = cityId
      ? await prisma.city.findUnique({ where: { id: cityId }, select: { name: true } })
      : null;

    let payload: ExportPayload | null = null;

    if (type === "sales") {
      const { title, meta } = buildExportMeta("Sales Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const saleDate = buildExportDateFilter(dateFrom, dateTo);
      const sales = await prisma.sale.findMany({
        where: {
          ...cityFilter,
          ...(statusFilter ? { status: statusFilter as any } : {}),
          ...(saleDate ? { saleDate } : {}),
        },
        include: {
          customer: { select: { name: true } },
          currency: true,
          lot: { select: { lotNumber: true } },
          godown: { select: { name: true } },
          items: { include: { product: true } },
          city: { select: { name: true } },
          creator: { select: { fullName: true } },
        },
        orderBy: { saleDate: "asc" },
      });
      const filteredSales = sales.filter((s) =>
        matchesExportTextSearch(
          search,
          [
            s.voucherNo,
            s.customer?.name,
            s.lot?.lotNumber,
            s.godown?.name,
            s.city?.name,
            s.creator?.fullName,
            s.status,
            s.notes,
            s.cancellationReason,
            s.currency?.code,
            s.currency?.symbol,
            ...s.items.map((i) => i.product?.name),
          ],
          [
            Number(s.totalAmount || 0),
            ...s.items.flatMap((i) => [Number(i.qty || 0), Number(i.ratePerCarton || 0), Number(i.amount || 0)]),
          ],
        ),
      );
      const headers = ["Date", "Customer", "Qty", "Size", "Price", "Amount", "Godown", "Lot", "Ref. No.", "Status"];
      const dataRows: string[][] = [];
      for (const s of filteredSales) {
        for (const item of s.items) {
          dataRows.push([
            formatDate(s.saleDate),
            cleanText(s.customer.name),
            fmtAmountCsv(Number(item.qty)),
            cleanText(item.product.name),
            fmtReportMoney(Number(item.ratePerCarton), s.currency.symbol, s.currency.code),
            fmtReportMoney(Number(item.amount), s.currency.symbol, s.currency.code),
            cleanText(s.godown.name),
            cleanText(s.lot.lotNumber),
            s.voucherNo,
            formatStatus(s.status),
          ]);
        }
      }
      payload = { title, meta, headers, rows: dataRows };
    } else if (type === "payments") {
      const { title, meta } = buildExportMeta("Payments Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const paymentDate = buildExportDateFilter(dateFrom, dateTo);
      const searchWhere = buildPaymentExportSearchWhere(search);
      const payments = await prisma.payment.findMany({
        where: {
          ...cityFilter,
          ...(paymentDate ? { paymentDate } : {}),
          ...(searchWhere || {}),
        },
        include: { customer: { select: { name: true } }, currency: true },
        orderBy: { paymentDate: "asc" },
      });
      const headers = ["Date", "Customer Name", "Particulars", "Amount", "Ref. No.", "Destination", "Status"];
      const dataRows = payments.map((p) => [
        formatDate(p.paymentDate),
        cleanText(p.customer.name),
        cleanText(p.detail),
        fmtReportMoney(Number(p.amount), p.currency.symbol, p.currency.code),
        cleanText(p.manualVoucherNo || ""),
        formatLabel(p.destination),
        formatStatus(p.status),
      ]);
      payload = { title, meta, headers, rows: dataRows, reportType: "payments" };
    } else if (type === "expenses") {
      const { title, meta } = buildExportMeta("Expenses Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const expenseDate = buildExportDateFilter(dateFrom, dateTo);
      const searchWhere = buildExpenseExportSearchWhere(search);
      const expenses = await prisma.expense.findMany({
        where: {
          ...cityFilter,
          deletedAt: null,
          ...(expenseDate ? { expenseDate } : {}),
          ...(searchWhere || {}),
        },
        include: { currency: true, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
        orderBy: { expenseDate: "asc" },
      });
      const headers = ["Date", "City", "Particulars", "Amount", "Lot", "Notes"];
      const dataRows = expenses.map((e) => [
        formatDate(e.expenseDate),
        cleanText(e.city.name),
        cleanText(e.detail),
        fmtReportMoney(Number(e.amount), e.currency.symbol, e.currency.code),
        cleanText(e.lot.lotNumber),
        cleanText(e.notes || ""),
      ]);
      payload = { title, meta, headers, rows: dataRows };
    } else if (type === "haji_transfers") {
      const { title, meta } = buildExportMeta("Haji Transfers Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const transferDate = buildExportDateFilter(dateFrom, dateTo);
      const transfers = await prisma.hajiTransfer.findMany({
        where: { ...cityFilter, ...(transferDate ? { transferDate } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { transferDate: "asc" },
      });
      const filtered = transfers.filter((h) =>
        matchesExportTextSearch(
          search,
          [h.detail, h.transferType, h.transferredTo, h.notes, h.lot?.lotNumber, h.currency?.code],
          [Number(h.amount || 0)],
        ),
      );
      const headers = ["Date", "Particulars", "Amount", "Transfer Type", "Transferred To", "Lot", "Notes"];
      const dataRows = filtered.map((h) => [
        formatDate(h.transferDate),
        cleanText(h.detail),
        fmtReportMoney(Number(h.amount), h.currency.symbol, h.currency.code),
        formatLabel(h.transferType),
        cleanText(h.transferredTo || ""),
        cleanText(h.lot?.lotNumber || ""),
        cleanText(h.notes || ""),
      ]);
      payload = { title, meta, headers, rows: dataRows };
    } else if (type === "customer_ledger") {
      const customerId = searchParams.get("customer_id") ? parseInt(searchParams.get("customer_id")!) : undefined;
      if (!customerId) return new Response("customer_id required for customer ledger export", { status: 400 });

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { city: { select: { id: true, name: true, country: { select: { code: true } } } } },
      });
      if (!customer) return new Response("Customer not found", { status: 404 });
      if (cityId && customer.cityId !== cityId) return new Response("Customer does not belong to selected city", { status: 403 });

      const { title, meta } = buildExportMeta(
        customer.name,
        customer.city.name,
        dateFrom,
        dateTo,
        search.rawQuery,
      );
      const saleDate = buildExportDateFilter(dateFrom, dateTo);
      const paymentDate = buildExportDateFilter(dateFrom, dateTo);

      const [sales, payments] = await Promise.all([
        prisma.sale.findMany({
          where: { customerId, ...(saleDate ? { saleDate } : {}) },
          include: { currency: true, items: { include: { product: true } }, lot: { select: { lotNumber: true } } },
          orderBy: { saleDate: "asc" },
        }),
        prisma.payment.findMany({
          where: { customerId, ...(paymentDate ? { paymentDate } : {}) },
          include: { currency: true, lot: { select: { lotNumber: true } } },
          orderBy: { paymentDate: "asc" },
        }),
      ]);

      let transactions = [
        ...sales.map((s) => ({
          type: "sale",
          date: s.saleDate,
          voucherNo: s.voucherNo,
          detail: (s.items || []).map((i) => `${i.product.name} x ${Number(i.qty)}`).join(", "),
          perCartonPrice: formatPerCartonRate((s.items || []).map((i) => Number(i.ratePerCarton)).filter((value) => !Number.isNaN(value))),
          debit: s.status === "active" ? Number(s.totalAmount) : 0,
          credit: 0,
          status: s.status,
          currency: s.currency.code,
          currencySymbol: s.currency.symbol || s.currency.code,
          lotNumber: s.lot?.lotNumber || "",
        })),
        ...payments.map((p) => ({
          type: "payment",
          date: p.paymentDate,
          voucherNo: p.manualVoucherNo || "-",
          detail: formatCustomerLedgerPaymentDetail(p),
          perCartonPrice: "-",
          debit: 0,
          credit: p.status === "active" ? Number(p.amount) : 0,
          status: p.status,
          currency: p.currency.code,
          currencySymbol: p.currency.symbol || p.currency.code,
          lotNumber: p.lot?.lotNumber || "",
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      if (search.normalizedQuery) {
        transactions = transactions.filter((t) =>
          matchesExportTextSearch(
            search,
            [t.voucherNo, t.detail, t.lotNumber, t.currency, t.currencySymbol, t.type, t.status, t.perCartonPrice],
            [t.debit, t.credit],
          ),
        );
      }

      const headers = ["Date", "Entry Type", "Reference No.", "Particulars", "Per Crt Price", "Lot", "Debit", "Credit", "Balance", "Status"];

      const runningByCurrency: Record<string, number> = {};
      const dataRows: string[][] = [];
      for (const t of transactions) {
        runningByCurrency[t.currency] = (runningByCurrency[t.currency] || 0) + t.debit - t.credit;
        dataRows.push([
          formatDate(t.date),
          t.type === "sale" ? "Sale" : "Receipt",
          t.voucherNo,
          cleanText(t.detail),
          t.perCartonPrice,
          t.lotNumber,
          fmtReportMoney(t.debit, t.currencySymbol, t.currency),
          fmtReportMoney(t.credit, t.currencySymbol, t.currency),
          fmtReportMoney(runningByCurrency[t.currency], t.currencySymbol, t.currency),
          formatStatus(t.status),
        ]);
      }
      payload = { title, meta, headers, rows: dataRows.reverse() };
    } else if (type === "ledger") {
      if (!cityId) return new Response("city_id required for ledger export", { status: 400 });
      const { title, meta } = buildExportMeta("City Ledger Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const [sales, payments, expenses, withdrawals, hajiTransfers] = await Promise.all([
        prisma.sale.findMany({ where: { cityId, status: { in: ["active", "marked_short"] } }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { saleDate: "asc" } }),
        prisma.payment.findMany({ where: { cityId }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { paymentDate: "asc" } }),
        prisma.expense.findMany({ where: { cityId, deletedAt: null }, include: { currency: true }, orderBy: { expenseDate: "asc" } }),
        prisma.personalWithdrawal.findMany({ where: { cityId }, include: { currency: true }, orderBy: { withdrawalDate: "asc" } }),
        prisma.hajiTransfer.findMany({ where: { cityId }, include: { currency: true }, orderBy: { transferDate: "asc" } }),
      ]);

      let entries: any[] = [];
      sales.forEach((s) => entries.push({ date: s.saleDate, type: "Sale", desc: `Sale to ${s.customer.name} (V#${s.voucherNo})`, debit: Number(s.totalAmount), credit: 0, currencySymbol: s.currency.symbol || s.currency.code, currencyCode: s.currency.code }));
      payments.forEach((p) => entries.push({ date: p.paymentDate, type: "Payment", desc: `${p.detail} from ${p.customer.name} (${p.paymentMethod}→${p.destination})`, debit: 0, credit: Number(p.amount), currencySymbol: p.currency.symbol || p.currency.code, currencyCode: p.currency.code }));
      expenses.forEach((e) => entries.push({ date: e.expenseDate, type: "Expense", desc: e.detail, debit: Number(e.amount), credit: 0, currencySymbol: e.currency.symbol || e.currency.code, currencyCode: e.currency.code }));
      withdrawals.forEach((w) => entries.push({ date: w.withdrawalDate, type: "Withdrawal", desc: w.detail, debit: Number(w.amount), credit: 0, currencySymbol: w.currency.symbol || w.currency.code, currencyCode: w.currency.code }));
      hajiTransfers.forEach((h) => entries.push({ date: h.transferDate, type: "Haji Transfer", desc: `${h.detail} (${h.transferType})`, debit: Number(h.amount), credit: 0, currencySymbol: h.currency.symbol || h.currency.code, currencyCode: h.currency.code }));

      if (search.normalizedQuery) {
        entries = entries.filter((e) =>
          matchesExportTextSearch(search, [e.type, e.desc, e.currencyCode, e.currencySymbol], [e.debit, e.credit]),
        );
      }
      entries.sort((a, b) => a.date.getTime() - b.date.getTime());

      const headers = ["Date", "Entry Type", "Particulars", "Debit", "Credit"];
      const rows: string[][] = [];
      appendExportMetaRows(rows, title, meta);
      rows.push(headers);
      const dataRows: string[][] = [];
      for (const e of entries) {
        dataRows.push([
          formatDate(e.date),
          e.type,
          cleanText(e.desc),
          fmtReportMoney(e.debit, e.currencySymbol, e.currencyCode),
          fmtReportMoney(e.credit, e.currencySymbol, e.currencyCode),
        ]);
      }
      rows.push(...dataRows);
      payload = { title, meta, headers, rows: dataRows };
    }

    if (!payload) return new Response("Unsupported export type", { status: 400 });

    if (format === "json") {
      return successResponse(payload);
    }

    const fullRows: string[][] = [];
    appendExportMetaRows(fullRows, payload.title, payload.meta);
    fullRows.push(payload.headers);
    fullRows.push(...payload.rows);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.addRows(fullRows);
    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    return new Response(xlsxBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${type}_report_${new Date().toISOString().split("T")[0]}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return new Response("Export failed", { status: 500 });
  }
});
