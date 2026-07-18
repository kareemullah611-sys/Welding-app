import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildSupplierRunningLedger, buildSupplierStatement } from "@/lib/supplier-ledger";

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
            superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
            intermediary: { select: { id: true, name: true } },
          },
          orderBy: { paymentDate: "desc" },
        },
        hajiDestinationTransfers: {
          include: {
            lot: { select: { id: true, lotNumber: true } },
          },
          orderBy: { transferDate: "desc" },
        },
      },
    });
    if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);

    const totalPurchasedUsd = supplier.lotPurchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);
    const totalHajiPartyDepositsUsd = supplier.hajiDestinationTransfers.reduce((s, p) => s + Number(p.amount), 0);
    const totalPaidUsd = supplier.supplierPayments.reduce((s, p) => s + Number(p.amountUsd), 0) + totalHajiPartyDepositsUsd;
    const balanceOwed = totalPurchasedUsd - totalPaidUsd;
    const { rows: statement, nextLotToPay } = buildSupplierStatement(supplier);
    const runningLedger = buildSupplierRunningLedger(supplier);

    return successResponse({
      ...supplier, id: supplier.id, name: supplier.name,
      totalPurchasedUsd, totalPaidUsd, balanceOwed,
      nextLotToPay,
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
        superAdminBankAccountId: p.superAdminBankAccountId || null,
        intermediaryId: p.intermediaryId || null,
        bankAccountName: p.superAdminBankAccount
          ? `${p.superAdminBankAccount.bankName}${p.superAdminBankAccount.accountNumber ? ` (${p.superAdminBankAccount.accountNumber})` : ""}`
          : p.bankAccount
          ? `${p.bankAccount.bankName}${p.bankAccount.accountNumber ? ` (${p.bankAccount.accountNumber})` : ""}`
          : null,
        intermediaryName: p.intermediary?.name || null,
        notes: p.notes || "",
      })),
      hajiPartyDeposits: supplier.hajiDestinationTransfers.map((h) => ({
        id: h.id,
        lotNumber: h.lot?.lotNumber || "General",
        lotId: h.lotId || null,
        paymentDate: h.transferDate.toISOString().split("T")[0],
        amountUsd: Number(h.amount),
        reference: h.referenceNo,
        notes: h.notes || "",
      })),
      ledger: runningLedger,
      runningLedger,
      statement,
    });
  } catch (error) { console.error("Get supplier error:", error); return serverError(); }
});

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
