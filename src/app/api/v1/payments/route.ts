import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { journalPaymentReceived, journalChequeReceived } from "@/lib/accounting";
import { createPaymentSchema } from "@/lib/validations";
import { getPaymentHajiAuditStateMap, isHajiAuditEligible } from "@/lib/payment-audit";
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
    const chequeStatus = searchParams.get("cheque_status") as "in_hand" | "deposited_to_bank" | "sent_to_haji" | "used_for_expense" | "used_for_withdrawal" | "bounced" | undefined;
    const fetchAll = searchParams.get("all") === "1";

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (customerId) where.customerId = customerId;
    if (lotId) where.lotId = lotId;
    if (status) where.status = status;
    if (method) where.paymentMethod = method;
    if (destination) where.destination = destination;
    if (chequeStatus) where.chequeStatus = chequeStatus;
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
          city: { select: { id: true, name: true } },
          currency: true,
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          creator: { select: { id: true, fullName: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { paymentDate: "desc" },
        ...(fetchAll ? {} : { skip, take: limit }),
      } as any),
      prisma.payment.count({ where }),
    ]);
    const hajiAuditStateById = await getPaymentHajiAuditStateMap(payments.map((p) => p.id));

    const formatted = (payments as any[]).map((p: any) => ({
      id: p.id,
      cityId: p.cityId,
      cityName: (p as any).city?.name ?? null,
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
      chequeNumber: (p as any).chequeNumber ?? null,
      chequeBank: (p as any).chequeBank ?? null,
      chequeDueDate: (p as any).chequeDueDate ? new Date((p as any).chequeDueDate).toISOString().split("T")[0] : null,
      chequeStatus: (p as any).chequeStatus ?? null,
      bankAccountId: (p as any).bankAccountId ?? null,
      bankAccount: (p as any).bankAccount ?? null,
      superAdminBankAccountId: (p as any).superAdminBankAccountId ?? null,
      superAdminBankAccount: (p as any).superAdminBankAccount ?? null,
      hajiAudit: isHajiAuditEligible(p) ? (hajiAuditStateById[p.id] || null) : null,
      bankDepositId: (p as any).bankDepositId ?? null,
      customer: p.customer,
      lot: { id: p.lot.id, lotNumber: p.lot.lotNumber, status: p.lot.status },
      currency: { id: p.currency.id, code: p.currency.code, symbol: p.currency.symbol },
      createdBy: p.creator,
      attachments: ((p as any).attachments || []).map((a: any) => ({
        ...a,
        filePath: a.filePath.split("|||")[0],
      })),
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

    let { customerId, lotId, paymentDate, detail, amount, currencyId, exchangeRate, usdEquivalent, manualVoucherNo, paymentMethod, destination, notes } = parsed.data;
    const chequeNumberInput: string | undefined = body.chequeNumber;
    const chequeBank: string | undefined = body.chequeBank;
    const chequeDueDate: string | undefined = body.chequeDueDate;
    const cityId = user.cityId!;
    const bankAccountId: number | undefined = body.bankAccountId ? parseInt(body.bankAccountId) : undefined;
    const superAdminBankAccountId: number | undefined = body.superAdminBankAccountId ? parseInt(body.superAdminBankAccountId) : undefined;
    const chequeNumber = paymentMethod === "cheque"
      ? (manualVoucherNo?.trim() || chequeNumberInput?.trim() || undefined)
      : chequeNumberInput?.trim() || undefined;

    // Handle walk-in customer (id = -1): find or create per city
    if (customerId === -1) {
      let walkin = await prisma.customer.findFirst({ where: { cityId, name: "Walk-in Customer", isActive: true } });
      if (!walkin) walkin = await prisma.customer.create({ data: { cityId, name: "Walk-in Customer", isActive: true } });
      customerId = walkin.id;
    }

    // Validate customer belongs to this city
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, cityId, isActive: true },
    });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city");

    // Validate currency (fall back to city's first currency if none specified)
    const cityCurrency = await prisma.cityCurrency.findFirst({
      where: { cityId, currencyId: currencyId ?? undefined },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");
    const resolvedCurrencyId = currencyId ?? cityCurrency.currencyId;

    const city = await prisma.city.findUnique({
      where: { id: cityId },
      include: { country: { select: { name: true } } },
    });
    const isAfghanistanCity = city?.country?.name === "Afghanistan";
    if (isAfghanistanCity && paymentMethod !== "cash") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan cities can record cash payments only");
    }

    const isBankLikePayment = paymentMethod === "bank_transfer" || paymentMethod === "online";
    if (isBankLikePayment && destination === "our_account") {
      if (!bankAccountId) {
        return errorResponse("VALIDATION_ERROR", "Please select the city bank account that received this payment");
      }
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!bankAccount || !bankAccount.isActive) {
        return errorResponse("NOT_FOUND", "Selected city bank account not found", 404);
      }
      if (bankAccount.cityId !== cityId) {
        return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
      }
    }
    if (isBankLikePayment && destination === "haji") {
      if (!superAdminBankAccountId) {
        return errorResponse("VALIDATION_ERROR", "Please select the super admin bank account that received this payment");
      }
      const superAdminAccount = await prisma.superAdminBankAccount.findUnique({ where: { id: superAdminBankAccountId } });
      if (!superAdminAccount || !superAdminAccount.isActive) {
        return errorResponse("NOT_FOUND", "Selected super admin bank account not found", 404);
      }
    }
    if (!isBankLikePayment && (bankAccountId || superAdminBankAccountId)) {
      return errorResponse("VALIDATION_ERROR", "Bank account selection is only allowed for bank transfer or online payments");
    }
    if (bankAccountId && superAdminBankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Select only one bank account");
    }

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

    // Validate no duplicate active cheque number in this city
    if (paymentMethod === "cheque" && chequeNumber) {
      const duplicate = await prisma.payment.findFirst({
        where: { cityId, status: "active", paymentMethod: "cheque", chequeNumber } as any,
      });
      if (duplicate) return errorResponse("CONFLICT", `Cheque number "${chequeNumber}" already exists in an active payment for this city`, 409);
    }

    // Determine chequeStatus for cheque payments destined to our_account
    const chequeStatus = (paymentMethod === "cheque" && destination === "our_account") ? "in_hand" : undefined;

    // Create payment (without new columns so it works before migration is run)
    const payment = await prisma.payment.create({
      data: {
        cityId,
        customerId,
        lotId: lotId!,
        paymentDate: new Date(paymentDate),
        detail,
        amount,
        currencyId: resolvedCurrencyId,
        manualVoucherNo: manualVoucherNo?.trim() || null,
        paymentMethod,
        destination,
        notes,
        createdBy: user.userId,
        ...(chequeNumber !== undefined ? { chequeNumber } : {}),
        ...(chequeBank !== undefined ? { chequeBank } : {}),
        ...(chequeDueDate ? { chequeDueDate: new Date(chequeDueDate) } : {}),
        ...(chequeStatus !== undefined ? { chequeStatus } : {}),
        ...(bankAccountId !== undefined ? { bankAccountId } : {}),
        ...(superAdminBankAccountId !== undefined ? { superAdminBankAccountId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true } },
        lot: { select: { id: true, lotNumber: true, status: true } },
        currency: true,
        bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        creator: { select: { id: true, fullName: true } },
      },
    } as any) as any;

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
      date: paymentDate,
      customer: payment.customer.name,
      detail: payment.detail,
      amount: `${payment.currency.symbol || payment.currency.code} ${Number(payment.amount).toLocaleString("en-US")}`,
      method: paymentMethod,
      ...(destination ? { destination } : {}),
      ...(notes ? { notes } : {}),
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
      bankAccountId: payment.bankAccountId ?? null,
      bankAccount: payment.bankAccount ?? null,
      superAdminBankAccountId: (payment as any).superAdminBankAccountId ?? null,
      superAdminBankAccount: (payment as any).superAdminBankAccount ?? null,
    };

    try {
      const journalFn = (paymentMethod === "cheque" && destination === "our_account") ? journalChequeReceived : journalPaymentReceived;
      await journalFn({
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
