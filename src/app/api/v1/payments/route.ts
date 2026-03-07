import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { journalPaymentReceived } from "@/lib/accounting";
import { createPaymentSchema } from "@/lib/validations";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams, getDateRange,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// Helper: Get FIFO lot for a city
async function getFIFOLot(cityId: number, countryId: number): Promise<number | null> {
  const lot = await prisma.lot.findFirst({
    where: {
      countryId,
      status: "ongoing",
      lotCityDistributions: { some: { cityId } },
    },
    orderBy: [{ lotDate: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return lot?.id || null;
}

// GET /api/v1/payments
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);

    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const customerId = searchParams.get("customer_id") ? parseInt(searchParams.get("customer_id")!) : undefined;
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;
    const status = searchParams.get("status") as "active" | "cancelled" | undefined;
    const method = searchParams.get("payment_method") as "cash" | "cheque" | "bank_transfer" | "online" | undefined;
    const destination = searchParams.get("destination") as "haji" | "our_account" | undefined;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (customerId) where.customerId = customerId;
    if (lotId) where.lotId = lotId;
    if (status) where.status = status;
    if (method) where.paymentMethod = method;
    if (destination) where.destination = destination;
    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) where.paymentDate.gte = dateFrom;
      if (dateTo) where.paymentDate.lte = dateTo;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          lot: { select: { id: true, lotNumber: true, status: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    const formatted = payments.map((p) => ({
      id: p.id,
      cityId: p.cityId,
      paymentDate: p.paymentDate.toISOString().split("T")[0],
      detail: p.detail,
      amount: Number(p.amount),
      exchangeRate: (p as any).exchangeRate ? Number((p as any).exchangeRate) : null,
      usdEquivalent: (p as any).usdEquivalent ? Number((p as any).usdEquivalent) : null,
      manualVoucherNo: p.manualVoucherNo,
      paymentMethod: p.paymentMethod,
      destination: p.destination,
      status: p.status,
      notes: p.notes,
      cancellationReason: p.cancellationReason,
      customer: p.customer,
      lot: { id: p.lot.id, lotNumber: p.lot.lotNumber, status: p.lot.status },
      currency: { id: p.currency.id, code: p.currency.code, symbol: p.currency.symbol },
      createdBy: p.creator,
      attachments: (p as any).attachments || [],
    }));

    return paginatedResponse(formatted, total, page, limit);
  } catch (error) {
    console.error("List payments error:", error);
    return serverError();
  }
});

// POST /api/v1/payments
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") {
      return errorResponse("FORBIDDEN", "Only city admins can create payments", 403);
    }

    const body = await request.json();
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid payment data", parsed.error.errors);

    const { customerId, paymentDate, detail, amount, currencyId, exchangeRate, usdEquivalent, manualVoucherNo, paymentMethod, destination, notes } = parsed.data;
    let lotId = parsed.data.lotId;
    const cityId = user.cityId!;

    // Validate customer belongs to this city
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, cityId, isActive: true },
    });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city");

    // Validate currency
    const cityCurrency = await prisma.cityCurrency.findFirst({
      where: { cityId, currencyId: currencyId ?? undefined },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");

    // FIFO lot assignment if not specified
    if (!lotId) {
      lotId = await getFIFOLot(cityId, user.countryId!);
      if (!lotId) return errorResponse("VALIDATION_ERROR", "No ongoing lot available for this city");
    }

    // Validate lot
    const lot = await prisma.lot.findFirst({
      where: {
        id: lotId,
        status: "ongoing",
        lotCityDistributions: { some: { cityId } },
      },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");

    // Create payment (without new columns so it works before migration is run)
    const payment = await prisma.payment.create({
      data: {
        cityId,
        customerId,
        lotId: lotId!,
        paymentDate: new Date(paymentDate),
        detail,
        amount,
        currencyId: currencyId as number,
        manualVoucherNo,
        paymentMethod,
        destination,
        notes,
        createdBy: user.userId,
      },
      include: {
        customer: { select: { id: true, name: true } },
        lot: { select: { id: true, lotNumber: true, status: true } },
        currency: true,
        creator: { select: { id: true, fullName: true } },
      },
    }) as any;

    // Store exchange rate fields via raw SQL — safe to skip if columns don't exist yet
    if (exchangeRate != null || usdEquivalent != null) {
      try {
        await prisma.$executeRaw`
          UPDATE payments
          SET exchange_rate = ${exchangeRate ?? null},
              usd_equivalent = ${usdEquivalent ?? null}
          WHERE id = ${payment.id}
        `;
      } catch (_) { /* columns not yet migrated — ignore */ }
    }

    await createAuditLog(user.userId, cityId, "payments", payment.id, "create", undefined, {
      customerId, lotId, amount, paymentMethod, destination,
    }, getClientIP(request));

    const responsePayData = {
      id: payment.id,
      paymentDate: payment.paymentDate.toISOString().split("T")[0],
      detail: payment.detail,
      amount: Number(payment.amount),
      exchangeRate: exchangeRate ?? null,
      usdEquivalent: usdEquivalent ?? null,
      manualVoucherNo: payment.manualVoucherNo,
      paymentMethod: payment.paymentMethod,
      destination: payment.destination,
      status: payment.status,
      customer: payment.customer,
      lot: { id: payment.lot.id, lotNumber: payment.lot.lotNumber },
      currency: { id: payment.currency.id, code: payment.currency.code, symbol: payment.currency.symbol },
      createdBy: payment.creator,
    };

    try {
      await journalPaymentReceived({
        id: payment.id, customerId: payment.customerId, cityId: payment.cityId, lotId: payment.lotId,
        amount: Number(payment.amount), currencyCode: payment.currency.code,
        paymentDate: payment.paymentDate, createdBy: user.userId,
      });
    } catch (je) { console.error("Journal entry error (payment):", je); }

    return successResponse(responsePayData, "Payment recorded successfully", 201);
  } catch (error) {
    console.error("Create payment error:", error);
    return serverError();
  }
});
