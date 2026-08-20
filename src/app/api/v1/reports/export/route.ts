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
import {
  formatCustomerLedgerPaymentDetail,
  formatCustomerLedgerSaleItemDetail,
  formatCustomerLedgerSaleItemRate,
} from "@/lib/customer-ledger-detail";

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

// GET /api/v1/reports/export?type=sales|payments|expenses|withdrawals|ledger|haji_transfers|customer_ledger
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
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;
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
          ...(lotId ? { items: { some: { lotId } } } : {}),
        },
        include: {
          customer: { select: { name: true } },
          currency: true,
          lot: { select: { lotNumber: true } },
          godown: { select: { name: true } },
          items: { include: { lot: { select: { lotNumber: true } }, product: true } },
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
        const exportItems = lotId ? s.items.filter((item) => item.lotId === lotId) : s.items;
        for (const item of exportItems) {
          dataRows.push([
            formatDate(s.saleDate),
            cleanText(s.customer.name),
            fmtAmountCsv(Number(item.qty)),
            cleanText(item.product.name),
            fmtReportMoney(Number(item.ratePerCarton), s.currency.symbol, s.currency.code),
            fmtReportMoney(Number(item.amount), s.currency.symbol, s.currency.code),
            cleanText(s.godown.name),
            cleanText(item.lot?.lotNumber || s.lot.lotNumber),
            s.voucherNo,
            formatStatus(s.status),
          ]);
        }
      }
      payload = { title, meta, headers, rows: dataRows };
    } else if (type === "payments") {
      const { title, meta } = buildExportMeta("Payments Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const selectedType = (searchParams.get("ledger_type") || "all").trim().toLowerCase();
      const dateWhere = (field: string) => {
        const where: any = {};
        if (dateFrom) where[field] = { ...(where[field] || {}), gte: new Date(dateFrom) };
        if (dateTo) where[field] = { ...(where[field] || {}), lte: new Date(dateTo + "T23:59:59") };
        return where;
      };
      const paymentRef = (row: { manualVoucherNo?: string | null; chequeNumber?: string | null }) => cleanText(row.manualVoucherNo || row.chequeNumber || "");
      const bankLabel = (account?: { bankName?: string | null; accountNumber?: string | null } | null) =>
        [account?.bankName, account?.accountNumber].map((part) => cleanText(part)).filter(Boolean).join("-");
      const paymentDetail = (p: any) => {
        const account = p.destination === "haji" ? p.superAdminBankAccount : p.bankAccount;
        const accountText = bankLabel(account);
        const method = formatLabel(p.paymentMethod).toLowerCase();
        const accountMethod = accountText ? `${accountText} ${method}` : method;
        const parts = [p.customer?.name, accountMethod || cleanText(p.detail)].filter(Boolean);
        return parts.join(" · ");
      };
      const expenseSource = (e: any) => {
        if (e.paidFrom === "bank_account") return bankLabel(e.bankAccount) || "Bank";
        if (e.paidFrom === "cheque") return "Cheque";
        if (e.paidFrom === "customer") return e.customerPayment?.customer?.name ? `Customer ${e.customerPayment.customer.name}` : "Customer";
        return "Cash office";
      };
      const withdrawalSource = (w: any) => {
        if (w.sourceType === "bank_account") return bankLabel(w.bankAccount) || "Bank";
        if (w.sourceType === "cheque") return "Cheque";
        return formatLabel(w.sourceType || "cash_office");
      };
      const hajiAccount = (h: any) => cleanText(h.transferredTo || h.detail);
      const entries: Array<{
        date: Date;
        type: string;
        name: string;
        particulars: string;
        ref: string;
        debit: number;
        credit: number;
        runningBalance?: number;
        currencySymbol: string;
        currencyCode: string;
      }> = [];

      if (selectedType === "all" || selectedType === "payment") {
        const payments = await prisma.payment.findMany({
          where: {
            ...cityFilter,
            status: "active",
            ...dateWhere("paymentDate"),
            ...(selectedType === "payment" ? (buildPaymentExportSearchWhere(search) || {}) : {}),
          },
          include: {
            customer: { select: { name: true } },
            currency: true,
            bankAccount: { select: { bankName: true, accountNumber: true } },
            superAdminBankAccount: { select: { bankName: true, accountNumber: true } },
          },
          orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
        });
        entries.push(...payments.map((p: any) => {
          const amount = Number(p.amount || 0);
          return {
            date: p.paymentDate,
            type: "Payment",
            name: cleanText(p.customer?.name || ""),
            particulars: paymentDetail(p),
            ref: paymentRef(p),
            debit: amount < 0 ? Math.abs(amount) : 0,
            credit: amount > 0 ? amount : 0,
            currencySymbol: p.currency.symbol,
            currencyCode: p.currency.code,
          };
        }));
      }

      if (selectedType === "all" || selectedType === "withdrawal") {
        const withdrawals = await prisma.personalWithdrawal.findMany({
          where: { ...cityFilter, ...dateWhere("withdrawalDate") },
          include: {
            currency: true,
            bankAccount: { select: { bankName: true, accountNumber: true } },
            chequePayment: { select: { manualVoucherNo: true, chequeNumber: true } },
          },
          orderBy: [{ withdrawalDate: "asc" }, { id: "asc" }],
        });
        entries.push(...withdrawals.map((w: any) => ({
          date: w.withdrawalDate,
          type: "Withdrawal",
          name: cleanText(w.withdrawnBy || ""),
          particulars: [w.withdrawnBy, w.detail, withdrawalSource(w)].map(cleanText).filter(Boolean).join(" · "),
          ref: paymentRef(w.chequePayment || {}),
          debit: Number(w.amount || 0),
          credit: 0,
          currencySymbol: w.currency.symbol,
          currencyCode: w.currency.code,
        })));
      }

      if (selectedType === "all" || selectedType === "expense") {
        const expenses = await prisma.expense.findMany({
          where: { ...cityFilter, deletedAt: null, ...dateWhere("expenseDate") },
          include: {
            currency: true,
            bankAccount: { select: { bankName: true, accountNumber: true } },
            chequePayment: { select: { manualVoucherNo: true, chequeNumber: true } },
            customerPayment: { select: { customer: { select: { name: true } } } },
          },
          orderBy: [{ expenseDate: "asc" }, { id: "asc" }],
        });
        entries.push(...expenses.map((e: any) => ({
          date: e.expenseDate,
          type: "Expense",
          name: "",
          particulars: [e.detail, expenseSource(e)].map(cleanText).filter(Boolean).join(" · "),
          ref: paymentRef(e.chequePayment || {}),
          debit: Number(e.amount || 0),
          credit: 0,
          currencySymbol: e.currency.symbol,
          currencyCode: e.currency.code,
        })));
      }

      if (selectedType === "all" || selectedType === "haji_transfer") {
        const transfers = await prisma.hajiTransfer.findMany({
          where: { ...cityFilter, ...dateWhere("transferDate") },
          include: { currency: true },
          orderBy: [{ transferDate: "asc" }, { id: "asc" }],
        });
        entries.push(...transfers.map((h: any) => ({
          date: h.transferDate,
          type: "Haji Transfer",
          name: hajiAccount(h),
          particulars: [hajiAccount(h), h.notes].map(cleanText).filter(Boolean).join(" · "),
          ref: cleanText(h.referenceNo || ""),
          debit: Number(h.amount || 0),
          credit: 0,
          currencySymbol: h.currency.symbol,
          currencyCode: h.currency.code,
        })));
      }

      let filteredEntries = entries;
      if (search.normalizedQuery) {
        filteredEntries = entries.filter((entry) => matchesExportTextSearch(
          search,
          [entry.type, entry.name, entry.particulars, entry.ref, entry.currencyCode, entry.currencySymbol],
          [entry.debit, entry.credit],
        ));
      }
      filteredEntries.sort((a, b) => a.date.getTime() - b.date.getTime());
      const runningByCurrency: Record<string, number> = {};
      for (const entry of filteredEntries) {
        runningByCurrency[entry.currencyCode] = (runningByCurrency[entry.currencyCode] || 0) + entry.credit - entry.debit;
        entry.runningBalance = runningByCurrency[entry.currencyCode];
      }
      const headers = ["Date", "Type", "Name", "Particulars", "Ref. No.", "Debit", "Credit", "Running Balance"];
      const dataRows = filteredEntries.map((entry) => [
        formatDate(entry.date),
        entry.type,
        cleanText(entry.name),
        cleanText(entry.particulars),
        cleanText(entry.ref),
        entry.debit ? fmtReportMoney(entry.debit, entry.currencySymbol, entry.currencyCode) : "",
        entry.credit ? fmtReportMoney(entry.credit, entry.currencySymbol, entry.currencyCode) : "",
        fmtReportMoney(entry.runningBalance || 0, entry.currencySymbol, entry.currencyCode),
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
    } else if (type === "withdrawals") {
      const { title, meta } = buildExportMeta("Withdrawals Report", city?.name, dateFrom, dateTo, search.rawQuery);
      const withdrawalDate = buildExportDateFilter(dateFrom, dateTo);
      const withdrawals = await prisma.personalWithdrawal.findMany({
        where: { ...cityFilter, ...(withdrawalDate ? { withdrawalDate } : {}) },
        include: { currency: true, city: { select: { name: true } } },
        orderBy: { withdrawalDate: "asc" },
      });
      const filtered = withdrawals.filter((w) =>
        matchesExportTextSearch(
          search,
          [w.detail, w.withdrawnBy, w.sourceType, w.notes, w.city?.name, w.currency?.code],
          [Number(w.amount || 0)],
        ),
      );
      const headers = ["Date", "City", "Particulars", "Withdrawn By", "Amount", "Source", "Notes"];
      const dataRows = filtered.map((w) => [
        formatDate(w.withdrawalDate),
        cleanText(w.city.name),
        cleanText(w.detail),
        cleanText(w.withdrawnBy),
        fmtReportMoney(Number(w.amount), w.currency.symbol, w.currency.code),
        formatLabel(String(w.sourceType || "")),
        cleanText(w.notes || ""),
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
      const ledgerType = (searchParams.get("ledger_type") || "all").trim().toLowerCase();
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
          include: { currency: true, items: { include: { product: true, lot: { select: { lotNumber: true } } } }, lot: { select: { lotNumber: true } } },
          orderBy: { saleDate: "asc" },
        }),
        prisma.payment.findMany({
          where: { customerId, ...(paymentDate ? { paymentDate } : {}) },
          include: {
            currency: true,
            lot: { select: { lotNumber: true } },
            bankAccount: { select: { bankName: true, accountNumber: true } },
            superAdminBankAccount: { select: { bankName: true, accountNumber: true } },
          },
          orderBy: { paymentDate: "asc" },
        }),
      ]);

      let transactions = [
        ...sales.flatMap((s) => (s.items || []).map((item) => ({
          type: "sale",
          date: s.saleDate,
          voucherNo: s.voucherNo,
          detail: formatCustomerLedgerSaleItemDetail(item),
          perCartonPrice: formatCustomerLedgerSaleItemRate(item),
          debit: s.status === "active" ? Number(item.amount) : 0,
          credit: 0,
          status: s.status,
          currency: s.currency.code,
          currencySymbol: s.currency.symbol || s.currency.code,
          lotNumber: item.lot?.lotNumber || s.lot?.lotNumber || "",
        }))),
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
      ].filter((t) => ledgerType === "all" || t.type === ledgerType)
        .sort((a, b) => a.date.getTime() - b.date.getTime());

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
