import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/reports/export?type=sales|payments|expenses|ledger&format=csv
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
        where: { ...cityFilter, status: "active", ...(Object.keys(df).length ? { saleDate: df } : {}) },
        include: { customer: { select: { name: true } }, currency: true, lot: { select: { lotNumber: true } }, godown: { select: { name: true } }, items: { include: { product: true } }, city: { select: { name: true } } },
        orderBy: { saleDate: "asc" },
      });
      csvRows.push("Date,Voucher,Customer,City,Godown,Lot,Product,Qty,Rate,Amount,Currency");
      for (const s of sales) {
        for (const item of s.items) {
          csvRows.push(`${s.saleDate.toISOString().split("T")[0]},${s.voucherNo},"${s.customer.name}","${s.city.name}","${s.godown.name}",${s.lot.lotNumber},"${item.product.name}",${Number(item.qty)},${Number(item.ratePerCarton)},${Number(item.amount)},${s.currency.code}`);
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
      csvRows.push("Date,Customer,City,Detail,Amount,Currency,Method,Destination,Lot,Voucher");
      for (const p of payments) {
        csvRows.push(`${p.paymentDate.toISOString().split("T")[0]},"${p.customer.name}","${p.city.name}","${p.detail}",${Number(p.amount)},${p.currency.code},${p.paymentMethod},${p.destination},${p.lot.lotNumber},${p.manualVoucherNo || ""}`);
      }
    } else if (type === "expenses") {
      const df: any = {};
      if (dateFrom) df.gte = new Date(dateFrom);
      if (dateTo) df.lte = new Date(dateTo);
      const expenses = await prisma.expense.findMany({
        where: { ...cityFilter, ...(Object.keys(df).length ? { expenseDate: df } : {}) },
        include: { currency: true, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
        orderBy: { expenseDate: "asc" },
      });
      csvRows.push("Date,City,Detail,Amount,Currency,Lot,Notes");
      for (const e of expenses) {
        csvRows.push(`${e.expenseDate.toISOString().split("T")[0]},"${e.city.name}","${e.detail}",${Number(e.amount)},${e.currency.code},${e.lot.lotNumber},"${e.notes || ""}"`);
      }
    } else if (type === "ledger") {
      // Full city ledger
      if (!cityId) return new Response("city_id required for ledger export", { status: 400 });
      const [sales, payments, expenses, withdrawals, hajiTransfers] = await Promise.all([
        prisma.sale.findMany({ where: { cityId, status: "active" }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { saleDate: "asc" } }),
        prisma.payment.findMany({ where: { cityId, status: "active" }, include: { customer: { select: { name: true } }, currency: true }, orderBy: { paymentDate: "asc" } }),
        prisma.expense.findMany({ where: { cityId }, include: { currency: true }, orderBy: { expenseDate: "asc" } }),
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
      csvRows.push("Date,Type,Description,Debit,Credit,Currency");
      let balance = 0;
      for (const e of entries) {
        balance += e.debit - e.credit;
        csvRows.push(`${e.date.toISOString().split("T")[0]},${e.type},"${e.desc}",${e.debit},${e.credit},${e.cur}`);
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
