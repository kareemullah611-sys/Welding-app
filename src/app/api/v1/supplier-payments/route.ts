import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalSupplierPaid } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSupplierPaymentSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError, paginatedResponse, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";

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
      intermediaryId: p.intermediaryId ?? null,
    })), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createSupplierPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    const source = await validatePaymentSource({
      bankAccountId: parsed.data.bankAccountId,
      intermediaryId: parsed.data.intermediaryId,
      requireSelection: true,
    });
    if (!source.ok) {
      return errorResponse(source.code, source.message, source.status || 400);
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: parsed.data.supplierId } });
    if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);

    const exchangeRate = parsed.data.exchangeRate ? Number(parsed.data.exchangeRate) : null;
    if (source.bankAccountId && (!exchangeRate || !Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      return validationError("Exchange rate is required when paying from a bank account");
    }
    const computedLocal = source.bankAccountId && exchangeRate
      ? round2(Number(parsed.data.amountUsd) * exchangeRate)
      : (parsed.data.amountLocal ? Number(parsed.data.amountLocal) : null);

    const payment = await prisma.supplierPayment.create({
      data: {
        supplierId: parsed.data.supplierId, lotId: parsed.data.lotId || null,
        paymentDate: new Date(parsed.data.paymentDate), amountUsd: parsed.data.amountUsd,
        exchangeRate, amountLocal: computedLocal,
        paymentMethod: parsed.data.paymentMethod as any, reference: parsed.data.reference,
        notes: parsed.data.notes, createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      },
    });

    await createAuditLog(user.userId, null, "supplier_payments", payment.id, "create", undefined, parsed.data, getClientIP(request));

    try {
      await journalSupplierPaid({
        id: payment.id, supplierId: parsed.data.supplierId, amountUsd: parsed.data.amountUsd,
        paymentDate: payment.paymentDate, createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      });
    } catch (je) { console.error("Journal (supplier pay):", je); }

    return successResponse({ id: payment.id }, "Payment recorded", 201);
  } catch (error) { console.error("Create supplier payment error:", error); return serverError(); }
});
