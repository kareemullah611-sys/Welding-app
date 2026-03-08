import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalHajiTransfer } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createHajiTransferSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (lotId) where.lotId = lotId;
    if (dateFrom || dateTo) {
      where.transferDate = {};
      if (dateFrom) where.transferDate.gte = dateFrom;
      if (dateTo) where.transferDate.lte = dateTo;
    }

    const transferredToFilter = searchParams.get("transferred_to");
    if (transferredToFilter) where.transferredTo = { contains: transferredToFilter, mode: "insensitive" };

    const [transfers, total] = await Promise.all([
      prisma.hajiTransfer.findMany({
        where,
        include: {
          lot: { select: { id: true, lotNumber: true, status: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { transferDate: "desc" },
        skip, take: limit,
      }),
      prisma.hajiTransfer.count({ where }),
    ]);

    return paginatedResponse(
      transfers.map((t) => ({
        id: t.id, cityId: t.cityId, lotId: t.lotId,
        lotNumber: t.lot.lotNumber, lotStatus: t.lot.status,
        transferDate: t.transferDate.toISOString().split("T")[0],
        amount: Number(t.amount), detail: t.detail,
        transferType: t.transferType, transferredTo: t.transferredTo,
        notes: t.notes,
        currency: { id: t.currency.id, code: t.currency.code, symbol: t.currency.symbol },
        createdBy: t.creator,
        attachments: t.attachments.map((a) => ({
          ...a,
          filePath: a.filePath.split("|||")[0],
        })),
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can record Haji transfers", 403);
    const body = await request.json();
    const parsed = createHajiTransferSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    const cityId = user.cityId!;
    let { lotId, transferDate, amount, currencyId, detail, transferType, transferredTo, notes } = parsed.data;

    // FIFO lot assignment if not specified
    if (!lotId) {
      const fifoLot = await prisma.lot.findFirst({
        where: { status: "ongoing", lotCityDistributions: { some: { cityId } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (!fifoLot) return errorResponse("VALIDATION_ERROR", "No ongoing lot available for your city");
      lotId = fifoLot.id;
    }

    const lot = await prisma.lot.findFirst({
      where: { id: lotId, lotCityDistributions: { some: { cityId } } },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found or not distributed to your city");

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");
    const resolvedCurrencyId = currencyId ?? cityCurrency.currencyId;

    const transfer = await prisma.hajiTransfer.create({
      data: { cityId, lotId, transferDate: new Date(transferDate), amount, currencyId: resolvedCurrencyId, detail, transferType, transferredTo, notes, createdBy: user.userId },
      include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    }) as any;

    await createAuditLog(user.userId, cityId, "haji_transfers", transfer.id, "create", undefined, { lotId, amount, transferType }, getClientIP(request));

    try {
      await journalHajiTransfer({ id: transfer.id, cityId, amount, currencyCode: transfer.currency.code, date: transfer.transferDate, createdBy: user.userId });
    } catch (je) { console.error("Journal (haji):", je); }

    return successResponse({
      id: transfer.id, lotNumber: transfer.lot.lotNumber,
      transferDate: transfer.transferDate.toISOString().split("T")[0],
      amount: Number(transfer.amount), detail: transfer.detail, transferType: transfer.transferType,
      currency: { id: transfer.currency.id, code: transfer.currency.code, symbol: transfer.currency.symbol },
      createdBy: transfer.creator,
    }, "Haji transfer recorded", 201);
  } catch (error) {
    return serverError();
  }
});
