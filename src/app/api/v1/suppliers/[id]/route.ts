import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const supplier = await prisma.supplier.findUnique({ where: { id },
      include: {
        lotPurchases: {
          include: {
            lot: { select: { id: true, lotNumber: true, lotDate: true, country: { select: { name: true } } } },
            product: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        supplierPayments: {
          include: {
            lot: { select: { id: true, lotNumber: true } },
            bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
            intermediary: { select: { id: true, name: true } },
          },
          orderBy: { paymentDate: "desc" },
        },
      },
    });
    if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);

    const totalPurchasedUsd = supplier.lotPurchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);
    const totalPaidUsd = supplier.supplierPayments.reduce((s, p) => s + Number(p.amountUsd), 0);
    const balanceOwed = totalPurchasedUsd - totalPaidUsd;
    const statement = buildSupplierStatement(supplier);

    return successResponse({
      ...supplier, id: supplier.id, name: supplier.name,
      totalPurchasedUsd, totalPaidUsd, balanceOwed,
      purchases: supplier.lotPurchases.map((p) => ({
        id: p.id, lotNumber: p.lot.lotNumber, productName: p.product.name,
        qty: Number(p.qty), unitPriceUsd: Number(p.unitPriceUsd), totalPriceUsd: Number(p.totalPriceUsd),
        exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null, createdAt: p.createdAt.toISOString(),
      })),
      payments: supplier.supplierPayments.map((p) => ({
        id: p.id, lotNumber: p.lot?.lotNumber || "General", paymentDate: p.paymentDate.toISOString().split("T")[0],
        amountUsd: Number(p.amountUsd), exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
        amountLocal: p.amountLocal ? Number(p.amountLocal) : null, paymentMethod: p.paymentMethod, reference: p.reference,
        lotId: p.lotId || null,
        bankAccountId: p.bankAccountId || null,
        intermediaryId: p.intermediaryId || null,
        bankAccountName: p.bankAccount ? `${p.bankAccount.bankName}${p.bankAccount.accountNumber ? ` (${p.bankAccount.accountNumber})` : ""}` : null,
        intermediaryName: p.intermediary?.name || null,
        notes: p.notes || "",
      })),
      ledger: buildSupplierLedger(supplier),
      statement,
    });
  } catch (error) { console.error("Get supplier error:", error); return serverError(); }
});

function buildSupplierStatement(supplier: any) {
  const byLot = new Map<number, {
    lotId: number;
    invoiceNumber: string;
    marketCountry: string;
    lotDate: Date;
    orderDetails: string[];
    quantityTons: number;
    amountUsd: number;
    appliedUsd: number;
    receiptNotes: string[];
  }>();

  for (const purchase of supplier.lotPurchases || []) {
    const lotId = Number(purchase.lotId);
    const existing = byLot.get(lotId);
    const qty = Number(purchase.qty || 0);
    const amountUsd = Number(purchase.totalPriceUsd || 0);
    const detailLine = `${purchase.product?.name || "Product"} ${qty}MT`;
    if (existing) {
      existing.quantityTons += qty;
      existing.amountUsd += amountUsd;
      existing.orderDetails.push(detailLine);
      continue;
    }
    byLot.set(lotId, {
      lotId,
      invoiceNumber: purchase.lot?.lotNumber || `LOT-${lotId}`,
      marketCountry: purchase.lot?.country?.name || "-",
      lotDate: new Date(purchase.lot?.lotDate || purchase.createdAt),
      orderDetails: [detailLine],
      quantityTons: qty,
      amountUsd,
      appliedUsd: 0,
      receiptNotes: [],
    });
  }

  const rows = Array.from(byLot.values()).sort((a, b) => a.lotDate.getTime() - b.lotDate.getTime());

  const sortedPayments = [...(supplier.supplierPayments || [])].sort(
    (a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
  );

  // FIFO allocation: oldest unsettled lot first.
  for (const payment of sortedPayments) {
    let remaining = Number(payment.amountUsd || 0);
    if (!Number.isFinite(remaining) || remaining <= 0) continue;
    while (remaining > 0.00001) {
      const target = rows.find((row) => row.amountUsd - row.appliedUsd > 0.00001);
      if (!target) break;
      const pending = target.amountUsd - target.appliedUsd;
      const appliedNow = Math.min(pending, remaining);
      target.appliedUsd += appliedNow;
      remaining -= appliedNow;
      target.receiptNotes.push(`$${appliedNow.toLocaleString("en-US")} received on ${new Date(payment.paymentDate).toISOString().split("T")[0]}`);
    }
  }

  let runningBalance = 0;
  return rows.map((row, index) => {
    const lotBalance = Math.max(0, Math.round((row.amountUsd - row.appliedUsd) * 100) / 100);
    runningBalance += lotBalance;
    return {
      itemNo: index + 1,
      lotId: row.lotId,
      invoiceNumber: row.invoiceNumber,
      marketCountry: row.marketCountry,
      orderDetails: row.orderDetails.join(" · "),
      quantityTons: Math.round(row.quantityTons * 1000) / 1000,
      amountUsd: Math.round(row.amountUsd * 100) / 100,
      depositUsd: Math.round(row.appliedUsd * 100) / 100,
      lotBalanceUsd: lotBalance,
      runningBalanceUsd: Math.round(runningBalance * 100) / 100,
      status: lotBalance <= 0 ? "settled" : "pending",
      receiptNotes: row.receiptNotes.join(" | "),
      date: row.lotDate.toISOString().split("T")[0],
    };
  });
}

function buildSupplierLedger(supplier: any) {
  const entries: any[] = [];
  for (const p of supplier.lotPurchases) {
    entries.push({
      date: p.lot.lotDate,
      type: "purchase",
      description: `${p.product.name} × ${Number(p.qty)} (Lot ${p.lot.lotNumber})`,
      debit: Number(p.totalPriceUsd),
      credit: 0,
      sourceId: p.id,
    });
  }
  for (const p of supplier.supplierPayments) {
    entries.push({
      date: p.paymentDate,
      type: "payment",
      description: `Payment ${p.paymentMethod} ${p.reference || ""}`.trim() + (p.lot ? ` (Lot ${p.lot.lotNumber})` : ""),
      debit: 0,
      credit: Number(p.amountUsd),
      sourceId: p.id,
    });
  }
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let balance = 0;
  return entries.map((e) => { balance += e.debit - e.credit; return { ...e, date: new Date(e.date).toISOString().split("T")[0], balance }; });
}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    await prisma.supplier.update({ where: { id }, data: { name: body.name, country: body.country, contact: body.contact, notes: body.notes } });
    return successResponse({ id }, "Supplier updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return successResponse({ id }, "Supplier deactivated");
  } catch (error) { return serverError(); }
});
