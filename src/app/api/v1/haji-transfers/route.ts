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
        sourceType: (t as any).sourceType ?? null,
        bankAccountId: (t as any).bankAccountId ?? null,
        chequePaymentId: (t as any).chequePaymentId ?? null,
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
    const cityId = user.cityId!;

    // Batch mode: one slip can include office cash plus one or more in-hand cheques.
    if (body.sourceType === "mixed_cash_cheque" || Array.isArray(body.chequePaymentIds)) {
      const transferDate = body.transferDate;
      const detail = typeof body.detail === "string" ? body.detail.trim() : "";
      const transferredTo = typeof body.transferredTo === "string" ? body.transferredTo.trim() : null;
      const notes = typeof body.notes === "string" ? body.notes : undefined;
      const cashAmount = Number(body.cashAmount || 0);
      const currencyId = body.currencyId ? parseInt(body.currencyId) : undefined;
      const lotIdInput = body.lotId ? parseInt(body.lotId) : undefined;
      const chequePaymentIds: number[] = Array.isArray(body.chequePaymentIds)
        ? Array.from(new Set(body.chequePaymentIds.map((id: any) => parseInt(id)).filter((id: number) => Number.isFinite(id) && id > 0))) as number[]
        : [];

      if (!transferDate) return errorResponse("VALIDATION_ERROR", "Transfer date is required");
      if (!detail) return errorResponse("VALIDATION_ERROR", "Detail is required");
      if (cashAmount <= 0 && chequePaymentIds.length === 0) {
        return errorResponse("VALIDATION_ERROR", "Enter a cash amount or select at least one cheque");
      }
      if (cashAmount > 0 && !currencyId) {
        return errorResponse("VALIDATION_ERROR", "Currency is required for the cash portion");
      }

      let lotId = lotIdInput;
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

      if (cashAmount > 0) {
        const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
        if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");
      }

      const chequePayments = chequePaymentIds.length > 0
        ? await prisma.payment.findMany({ where: { id: { in: chequePaymentIds } } })
        : [];
      if (chequePayments.length !== chequePaymentIds.length) {
        return errorResponse("NOT_FOUND", "One or more cheque payments were not found", 404);
      }
      for (const chequePayment of chequePayments) {
        if (chequePayment.cityId !== cityId) return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
        if ((chequePayment as any).paymentMethod !== "cheque") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
        if ((chequePayment as any).chequeStatus !== "in_hand") return errorResponse("VALIDATION_ERROR", "One or more selected cheques are not in-hand");
      }
      const existingTransfers = chequePaymentIds.length > 0
        ? await prisma.hajiTransfer.findMany({ where: { chequePaymentId: { in: chequePaymentIds } } as any, select: { chequePaymentId: true } })
        : [];
      if (existingTransfers.length > 0) {
        return errorResponse("CONFLICT", "One or more selected cheques have already been used for a Haji transfer", 409);
      }

      const createdTransfers = await prisma.$transaction(async (tx) => {
        const created: any[] = [];

        if (cashAmount > 0) {
          const cashTransfer = await tx.hajiTransfer.create({
            data: {
              cityId,
              lotId: lotId!,
              transferDate: new Date(transferDate),
              amount: cashAmount,
              currencyId,
              detail,
              transferType: "from_in_hand",
              transferredTo,
              notes,
              sourceType: "cash_office",
              createdBy: user.userId,
            } as any,
            include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
          });
          created.push(cashTransfer);
        }

        for (const chequePayment of chequePayments) {
          const chequeTransfer = await tx.hajiTransfer.create({
            data: {
              cityId,
              lotId: lotId!,
              transferDate: new Date(transferDate),
              amount: chequePayment.amount,
              currencyId: chequePayment.currencyId,
              detail,
              transferType: "direct",
              transferredTo,
              notes,
              sourceType: "cheque",
              chequePaymentId: chequePayment.id,
              createdBy: user.userId,
            } as any,
            include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
          });
          await tx.payment.update({
            where: { id: chequePayment.id },
            data: { chequeStatus: "sent_to_haji" } as any,
          });
          created.push(chequeTransfer);
        }

        return created;
      });

      for (const transfer of createdTransfers) {
        await createAuditLog(user.userId, cityId, "haji_transfers", transfer.id, "create", undefined, {
          lotId,
          amount: Number(transfer.amount),
          transferType: transfer.transferType,
          sourceType: transfer.sourceType,
        }, getClientIP(request));
        try {
          await journalHajiTransfer({
            id: transfer.id,
            cityId,
            amount: Number(transfer.amount),
            currencyCode: transfer.currency.code,
            date: transfer.transferDate,
            createdBy: user.userId,
            sourceType: transfer.sourceType,
            bankAccountId: (transfer as any).bankAccountId ?? null,
          });
        } catch (je) { console.error("Journal (haji batch):", je); }
      }

      return successResponse({
        count: createdTransfers.length,
        transfers: createdTransfers.map((transfer) => ({
          id: transfer.id,
          lotNumber: transfer.lot.lotNumber,
          transferDate: transfer.transferDate.toISOString().split("T")[0],
          amount: Number(transfer.amount),
          detail: transfer.detail,
          transferType: transfer.transferType,
          sourceType: transfer.sourceType ?? null,
          bankAccountId: transfer.bankAccountId ?? null,
          chequePaymentId: transfer.chequePaymentId ?? null,
          currency: { id: transfer.currency.id, code: transfer.currency.code, symbol: transfer.currency.symbol },
          createdBy: transfer.creator,
        })),
      }, "Haji transfer slip recorded", 201);
    }

    const parsed = createHajiTransferSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);
    let { lotId, transferDate, amount, currencyId, detail, transferType, transferredTo, notes } = parsed.data;

    // New source fields
    let sourceType: string = body.sourceType ?? undefined;
    const bankAccountId: number | undefined = body.bankAccountId ? parseInt(body.bankAccountId) : undefined;
    const chequePaymentId: number | undefined = body.chequePaymentId ? parseInt(body.chequePaymentId) : undefined;

    // Backward compatibility: map old transferType to sourceType if sourceType not provided
    if (!sourceType && transferType) {
      if (transferType === "from_in_hand") sourceType = "cash_office";
      else if (transferType === "direct") sourceType = "bank_transfer";
    }

    // Map sourceType back to transferType for storage backward compat
    if (sourceType && !transferType) {
      if (sourceType === "cash_office") transferType = "from_in_hand";
      else if (sourceType === "bank_transfer") transferType = "direct";
      else if (sourceType === "cheque") transferType = "direct";
    }

    // Validate cheque source
    if (sourceType === "cheque" && chequePaymentId) {
      const chequePayment = await prisma.payment.findUnique({ where: { id: chequePaymentId } });
      if (!chequePayment) return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
      if (chequePayment.cityId !== cityId) return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
      if ((chequePayment as any).paymentMethod !== "cheque") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
      if ((chequePayment as any).chequeStatus !== "in_hand") return errorResponse("VALIDATION_ERROR", "Cheque is not in-hand status");
      // Prevent same cheque being used for multiple haji transfers
      const existingTransfer = await prisma.hajiTransfer.findFirst({ where: { chequePaymentId } as any });
      if (existingTransfer) return errorResponse("CONFLICT", "This cheque has already been used for a haji transfer", 409);
    }

    // Validate bank account source
    if (sourceType === "bank_transfer" && bankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found", 404);
      if ((bankAccount as any).cityId !== cityId) return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
    }

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
      data: {
        cityId, lotId, transferDate: new Date(transferDate), amount, currencyId: resolvedCurrencyId,
        detail, transferType, transferredTo, notes, createdBy: user.userId,
        ...(sourceType !== undefined ? { sourceType } : {}),
        ...(bankAccountId !== undefined ? { bankAccountId } : {}),
        ...(chequePaymentId !== undefined ? { chequePaymentId } : {}),
      } as any,
      include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    }) as any;

    // If sourced from a cheque, update the cheque payment status to 'sent_to_haji'
    if (sourceType === "cheque" && chequePaymentId) {
      try {
        await prisma.payment.update({
          where: { id: chequePaymentId },
          data: { chequeStatus: "sent_to_haji" } as any,
        });
      } catch (_) { /* chequeStatus column not yet migrated — ignore */ }
    }

    await createAuditLog(user.userId, cityId, "haji_transfers", transfer.id, "create", undefined, { lotId, amount, transferType, sourceType }, getClientIP(request));

    try {
      await journalHajiTransfer({ id: transfer.id, cityId, amount, currencyCode: transfer.currency.code, date: transfer.transferDate, createdBy: user.userId, sourceType: transfer.sourceType, bankAccountId: (transfer as any).bankAccountId ?? null });
    } catch (je) { console.error("Journal (haji):", je); }

    return successResponse({
      id: transfer.id, lotNumber: transfer.lot.lotNumber,
      transferDate: transfer.transferDate.toISOString().split("T")[0],
      amount: Number(transfer.amount), detail: transfer.detail, transferType: transfer.transferType,
      sourceType: transfer.sourceType ?? null,
      bankAccountId: transfer.bankAccountId ?? null,
      chequePaymentId: transfer.chequePaymentId ?? null,
      currency: { id: transfer.currency.id, code: transfer.currency.code, symbol: transfer.currency.symbol },
      createdBy: transfer.creator,
    }, "Haji transfer recorded", 201);
  } catch (error) {
    return serverError();
  }
});
