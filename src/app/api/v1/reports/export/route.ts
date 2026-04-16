import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const escaped = raw.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

const csvRow = (values: unknown[]) => values.map(csvCell).join(",");

const fmtAmount = (value: number | string) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return Math.round(numeric * 100) / 100;
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
  status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (date: Date) => date.toISOString().split("T")[0];

// GET /api/v1/reports/export?type=sales|payments|expenses|ledger|haji_transfers|customer_ledger
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") || "sales";
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const cityFilter = cityId ? { cityId } : {};

    let csvRows: string[] = [];

    if (type === "sales") {
      const df: any = {};
      if (dateFrom) df.gte = new Date(dateFrom);
      if (dateTo) df.lte = new Date(dateTo);
      const sales = await prisma.sale.findMany({
        where: { ...cityFilter, status: { in: ["active", "marked_short"] }, ...(Object.keys(df).length ? { saleDate: df } : {}) },
        include: { customer: { select: { name: true } }, currency: true, lot: { select: { lotNumber: true } }, godown: { select: { name: true } }, items: { include: { product: true } }, city: { select: { name: true } } },
        orderBy: { saleDate: "asc" },
      });
      csvRows.push(csvRow(["Date", "Voucher", "Customer", "City", "Godown", "Lot", "Product", "Qty", "Rate Per Carton", "Amount", "Currency"]));
      for (const s of sales) {
        for (const item of s.items) {
          csvRows.push(csvRow([formatDate(s.saleDate), s.voucherNo, s.customer.name, s.city.name, s.godown.name, s.lot.lotNumber, item.product.name, fmtAmount(Number(item.qty)), fmtAmount(Number(item.ratePerCarton)), fmtAmount(Number(item.amount)), s.currency.code]));
        }
      }
    } else if (type === "payments") {
      const df: any = {};
      if (dateFrom) df.gte = new Date(dateFrom);
      if (dateTo) df.lte = new Date(dateTo);
      const payments = await prisma.payment.findMany({
        where: { ...cityFilter, status: "active", ...(Object.keys(df).length ? { paymentDate: df } : {}) },
        include: { customer: { select: { name: true } }, currency: true, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
        orderBy: { paymentDate: "asc" },
      });
      csvRows.push(csvRow(["Date", "Customer", "City", "Particulars", "Amount", "Currency", "Instrument", "Applied To", "Lot", "Reference No."]));
      for (const p of payments) {
        csvRows.push(csvRow([formatDate(p.paymentDate), p.customer.name, p.city.name, p.detail, fmtAmount(Number(p.amount)), p.currency.code, p.paymentMethod, p.destination, p.lot.lotNumber, p.manualVoucherNo || ""]));
      }
    } else if (type === "expenses") {
      const df: any = {};
      if (dateFrom) df.gte = new Date(dateFrom);
      if (dateTo) df.lte = new Date(dateTo);
      const expenses = await prisma.expense.findMany({
        where: { ...cityFilter, deletedAt: null, ...(Object.keys(df).length ? { expenseDate: df } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
        orderBy: { expenseDate: "asc" },
      });
      csvRows.push(csvRow(["Date", "City", "Particulars", "Amount", "Currency", "Lot", "Notes"]));
      for (const e of expenses) {
        csvRows.push(csvRow([formatDate(e.expenseDate), e.city.name, e.detail, fmtAmount(Number(e.amount)), e.currency.code, e.lot.lotNumber, e.notes || ""]));
      }
    } else if (type === "haji_transfers") {
      const df: any = {};
      if (dateFrom) df.gte = new Date(dateFrom);
      if (dateTo) df.lte = new Date(dateTo);
      const transfers = await prisma.hajiTransfer.findMany({
        where: { ...cityFilter, ...(Object.keys(df).length ? { transferDate: df } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { transferDate: "asc" },
      });
      csvRows.push(csvRow(["Date", "Particulars", "Amount", "Currency", "Transfer Type", "Transferred To", "Lot", "Notes"]));
      for (const h of transfers) {
        csvRows.push(csvRow([formatDate(h.transferDate), h.detail, fmtAmount(Number(h.amount)), h.currency.code, h.transferType, h.transferredTo || "", h.lot?.lotNumber || "", h.notes || ""]));
      }
    } else if (type === "customer_ledger") {
      const customerId = searchParams.get("customer_id") ? parseInt(searchParams.get("customer_id")!) : undefined;
      if (!customerId) return new Response("customer_id required for customer ledger export", { status: 400 });

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { city: { select: { id: true, name: true, country: { select: { code: true } } } } },
      });
      if (!customer) return new Response("Customer not found", { status: 404 });
      if (cityId && customer.cityId !== cityId) return new Response("Customer does not belong to selected city", { status: 403 });
      const isPakistanCity = customer.city.country?.code === "PK";

      const saleDateFilter: any = {};
      if (dateFrom) saleDateFilter.gte = new Date(dateFrom);
      if (dateTo) saleDateFilter.lte = new Date(dateTo);
      const paymentDateFilter: any = {};
      if (dateFrom) paymentDateFilter.gte = new Date(dateFrom);
      if (dateTo) paymentDateFilter.lte = new Date(dateTo);

      const [sales, payments] = await Promise.all([
        prisma.sale.findMany({
          where: { customerId, ...(Object.keys(saleDateFilter).length ? { saleDate: saleDateFilter } : {}) },
          include: { currency: true, items: { include: { product: true } }, lot: { select: { lotNumber: true } } },
          orderBy: { saleDate: "asc" },
        }),
        prisma.payment.findMany({
          where: { customerId, ...(Object.keys(paymentDateFilter).length ? { paymentDate: paymentDateFilter } : {}) },
          include: { currency: true, lot: { select: { lotNumber: true } } },
          orderBy: { paymentDate: "asc" },
        }),
      ]);

      const transactions = [
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
          lotNumber: s.lot?.lotNumber || "",
        })),
        ...payments.map((p) => ({
          type: "payment",
          date: p.paymentDate,
          voucherNo: p.manualVoucherNo || "-",
          detail: p.detail,
          perCartonPrice: "-",
          debit: 0,
          credit: p.status === "active" ? Number(p.amount) : 0,
          status: p.status,
          currency: p.currency.code,
          lotNumber: p.lot?.lotNumber || "",
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      const runningByCurrency: Record<string, number> = {};
      csvRows.push(csvRow(isPakistanCity
        ? ["Date", "Entry Type", "Reference No.", "Particulars", "Per Crt Price", "Lot", "Debit", "Credit", "Closing Balance", "Status"]
        : ["Date", "Entry Type", "Reference No.", "Particulars", "Per Crt Price", "Lot", "Debit", "Credit", "Closing Balance", "Currency", "Status"]));
      for (const t of transactions) {
        runningByCurrency[t.currency] = (runningByCurrency[t.currency] || 0) + t.debit - t.credit;
        const row = [
          formatDate(t.date),
          t.type === "sale" ? "Sales" : "Receipt",
          t.voucherNo,
          t.detail,
          t.perCartonPrice,
          t.lotNumber,
          fmtAmount(t.debit),
          fmtAmount(t.credit),
          fmtAmount(runningByCurrency[t.currency]),
        ];
        csvRows.push(csvRow(isPakistanCity ? [...row, formatStatus(t.status)] : [...row, t.currency, formatStatus(t.status)]));
      }
    } else if (type === "ledger") {
      // Full city ledger
      if (!cityId) return new Response("city_id required for ledger export", { status: 400 });
      const [sales, payments, expenses, withdrawals, hajiTransfers] = await Promise.all([
        prisma.sale.findMany({ where: { cityId, status: { in: ["active", "marked_short"] } }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { saleDate: "asc" } }),
        prisma.payment.findMany({ where: { cityId, status: "active" }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { paymentDate: "asc" } }),
        prisma.expense.findMany({ where: { cityId, deletedAt: null }, include: { currency: true }, orderBy: { expenseDate: "asc" } }),
        prisma.personalWithdrawal.findMany({ where: { cityId }, include: { currency: true }, orderBy: { withdrawalDate: "asc" } }),
        prisma.hajiTransfer.findMany({ where: { cityId }, include: { currency: true }, orderBy: { transferDate: "asc" } }),
      ]);

      const entries: any[] = [];
      sales.forEach((s) => entries.push({ date: s.saleDate, type: "Sale", desc: `Sale to ${s.customer.name} (V#${s.voucherNo})`, debit: Number(s.totalAmount), credit: 0, cur: s.currency.code }));
      payments.forEach((p) => entries.push({ date: p.paymentDate, type: "Payment", desc: `${p.detail} from ${p.customer.name} (${p.paymentMethod}→${p.destination})`, debit: 0, credit: Number(p.amount), cur: p.currency.code }));
      expenses.forEach((e) => entries.push({ date: e.expenseDate, type: "Expense", desc: e.detail, debit: Number(e.amount), credit: 0, cur: e.currency.code }));
      withdrawals.forEach((w) => entries.push({ date: w.withdrawalDate, type: "Withdrawal", desc: w.detail, debit: Number(w.amount), credit: 0, cur: w.currency.code }));
      hajiTransfers.forEach((h) => entries.push({ date: h.transferDate, type: "Haji Transfer", desc: `${h.detail} (${h.transferType})`, debit: Number(h.amount), credit: 0, cur: h.currency.code }));

      entries.sort((a, b) => a.date.getTime() - b.date.getTime());
      csvRows.push(csvRow(["Date", "Entry Type", "Particulars", "Debit", "Credit", "Currency"]));
      let balance = 0;
      for (const e of entries) {
        balance += e.debit - e.credit;
        csvRows.push(csvRow([formatDate(e.date), e.type, e.desc, fmtAmount(e.debit), fmtAmount(e.credit), e.cur]));
      }
    }

    const csv = csvRows.join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${type}_report_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return new Response("Export failed", { status: 500 });
  }
});
