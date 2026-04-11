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
        lotPurchases: { include: { lot: { select: { id: true, lotNumber: true, lotDate: true } }, product: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
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
    });
  } catch (error) { console.error("Get supplier error:", error); return serverError(); }
});

function buildSupplierLedger(supplier: any) {
  const entries: any[] = [];
  for (const p of supplier.lotPurchases) {
    entries.push({ date: p.lot.lotDate, type: "purchase", description: `${p.product.name} × ${Number(p.qty)} (Lot ${p.lot.lotNumber})`, debit: Number(p.totalPriceUsd), credit: 0 });
  }
  for (const p of supplier.supplierPayments) {
    entries.push({ date: p.paymentDate, type: "payment", description: `Payment ${p.paymentMethod} ${p.reference || ""}`.trim() + (p.lot ? ` (Lot ${p.lot.lotNumber})` : ""), debit: 0, credit: Number(p.amountUsd) });
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
