import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalSupplierPaid } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSupplierPaymentSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError, paginatedResponse, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { validateSupplierPaymentSettlement } from "@/lib/settlement-validation";
import { assertSuperAdminCashHasFunds } from "@/lib/haji-cash-balance";

const SUPPLIER_PAYMENT_SYNC_MODULE = "supplier_payments";
const SUPERADMIN_SYNC_CITY_ID = 0;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const supplierId = request.nextUrl.searchParams.get("supplier_id") ? parseInt(request.nextUrl.searchParams.get("supplier_id")!) : undefined;
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;

    const [payments, total] = await Promise.all([
      prisma.supplierPayment.findMany({
        where, include: { supplier: { select: { id: true, name: true } }, lot: { select: { id: true, lotNumber: true } } },
        orderBy: { paymentDate: "desc" }, skip, take: limit,
      }),
      prisma.supplierPayment.count({ where }),
    ]);

    return paginatedResponse(payments.map((p) => ({
      id: p.id, supplierId: p.supplierId, supplierName: p.supplier.name,
      lotId: p.lotId, lotNumber: p.lot?.lotNumber || null,
      paymentDate: p.paymentDate.toISOString().split("T")[0],
      amountUsd: Number(p.amountUsd), exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
      amountLocal: p.amountLocal ? Number(p.amountLocal) : null,
      paymentMethod: p.paymentMethod, reference: p.reference, notes: p.notes,
      bankAccountId: p.bankAccountId ?? null,
      superAdminBankAccountId: p.superAdminBankAccountId ?? null,
      intermediaryId: p.intermediaryId ?? null,
    })), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const parsed = createSupplierPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Payment already synced");
      }
    }

    const superAdminBankAccountId = parsed.data.superAdminBankAccountId || null;
    const superAdminCashAccountId = parsed.data.superAdminCashAccountId || null;
    const bankAccountId = parsed.data.bankAccountId || null;
    const intermediaryId = parsed.data.intermediaryId || null;

    if (Number(superAdminBankAccountId ? 1 : 0) + Number(superAdminCashAccountId ? 1 : 0) + Number(bankAccountId ? 1 : 0) + Number(intermediaryId ? 1 : 0) !== 1) {
      return validationError("Choose exactly one funding source: super admin bank, haji cash, intermediary, or legacy city bank");
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: parsed.data.supplierId } });
    if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);
    if (parsed.data.lotId) {
      const lot = await prisma.lot.findUnique({ where: { id: parsed.data.lotId }, select: { id: true } });
      if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
      const supplierInLot = await prisma.lotPurchase.findFirst({
        where: { lotId: parsed.data.lotId, supplierId: parsed.data.supplierId },
        select: { id: true },
      });
      if (!supplierInLot) {
        return validationError("Selected lot is not linked to this supplier");
      }
    }

    const exchangeRate = parsed.data.exchangeRate ? Number(parsed.data.exchangeRate) : null;

    let computedLocal = parsed.data.amountLocal ? Number(parsed.data.amountLocal) : null;
    let settlementCurrencyCode: string | null = null;

    if (superAdminCashAccountId) {
      const debitAmount = computedLocal && computedLocal > 0 ? computedLocal : Number(parsed.data.amountUsd);
      const funds = await assertSuperAdminCashHasFunds(superAdminCashAccountId, debitAmount);
      if (!funds.ok) return errorResponse("VALIDATION", funds.message, 400);
      computedLocal = debitAmount;
      const cashAcct = await prisma.superAdminBankAccount.findUnique({
        where: { id: superAdminCashAccountId },
        include: { currency: true },
      });
      settlementCurrencyCode = String(cashAcct?.currency?.code || "USD").toUpperCase();
    } else {
      const settlement = await validateSupplierPaymentSettlement({
        amountUsd: Number(parsed.data.amountUsd),
        superAdminBankAccountId,
        bankAccountId,
        intermediaryId,
        exchangeRate,
      });
      if (!settlement.ok) {
        return errorResponse(settlement.code, settlement.message, settlement.status || 400);
      }
      computedLocal = settlement.settlementCurrency === "PKR" && settlement.amountPkr
        ? settlement.amountPkr
        : (parsed.data.amountLocal ? Number(parsed.data.amountLocal) : null);
      settlementCurrencyCode = settlement.settlementCurrency === "PKR" ? "PKR" : null;
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierPayment.create({
        data: {
          supplierId: parsed.data.supplierId, lotId: parsed.data.lotId || null,
          paymentDate: new Date(parsed.data.paymentDate), amountUsd: parsed.data.amountUsd,
          exchangeRate, amountLocal: computedLocal,
          paymentMethod: parsed.data.paymentMethod as any, reference: parsed.data.reference,
          notes: parsed.data.notes, createdBy: user.userId,
          bankAccountId: superAdminBankAccountId || superAdminCashAccountId ? null : bankAccountId,
          superAdminBankAccountId,
          superAdminCashAccountId,
          intermediaryId,
        },
      });

      await createAuditLog(user.userId, null, "supplier_payments", created.id, "create", undefined, parsed.data, getClientIP(request), tx);

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "supplier_payments",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }

      await journalSupplierPaid({
        id: created.id, supplierId: parsed.data.supplierId, amountUsd: parsed.data.amountUsd,
        amountLocal: computedLocal,
        paymentDate: created.paymentDate, createdBy: user.userId,
        bankAccountId: superAdminBankAccountId || superAdminCashAccountId ? null : bankAccountId,
        superAdminBankAccountId,
        superAdminCashAccountId,
        intermediaryId,
        settlementCurrencyCode,
      }, tx);
      return created;
    });

    return successResponse({ id: payment.id }, "Payment recorded", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Payment already synced");
      }
    }
    console.error("Create supplier payment error:", error);
    return serverError();
  }
});
