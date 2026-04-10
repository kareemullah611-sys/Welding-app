import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalHajiTransfer } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createHajiTransferSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

const PAKISTAN_HAJI_TARGET = "Super Admin Account";

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

    const [transfers, directPayments, transferCount, directPaymentsCount] = await Promise.all([
      prisma.hajiTransfer.findMany({
        where,
        include: {
          lot: { select: { id: true, lotNumber: true, status: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { transferDate: "desc" },
      }),
      prisma.payment.findMany({
        where: {
          ...(cityId ? { cityId } : {}),
          ...(dateFrom || dateTo ? {
            paymentDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          } : {}),
          destination: "haji",
          status: "active",
        },
        include: {
          customer: { select: { id: true, name: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
        },
        orderBy: { paymentDate: "desc" },
      }),
      prisma.hajiTransfer.count({ where }),
      prisma.payment.count({
        where: {
          ...(cityId ? { cityId } : {}),
          ...(dateFrom || dateTo ? {
            paymentDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          } : {}),
          destination: "haji",
          status: "active",
        },
      }),
    ]);

    const rows = [
      ...transfers.map((t) => ({
        id: t.id, cityId: t.cityId, lotId: t.lotId,
        recordType: "haji_transfer",
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
      ...directPayments.map((p) => ({
        id: p.id,
        cityId: p.cityId,
        lotId: p.lotId,
        recordType: "customer_payment",
        lotNumber: "",
        lotStatus: null,
        transferDate: p.paymentDate.toISOString().split("T")[0],
        amount: Number(p.amount),
        detail: p.detail,
        transferType: "customer_direct",
        transferredTo: p.customer?.name || null,
        sourceType: p.paymentMethod,
        bankAccountId: null,
        chequePaymentId: null,
        notes: p.notes,
        currency: { id: p.currency.id, code: p.currency.code, symbol: p.currency.symbol },
        createdBy: p.creator,
        attachments: [],
      })),
    ].sort((a, b) => {
      if (b.transferDate !== a.transferDate) return b.transferDate.localeCompare(a.transferDate);
      return b.id - a.id;
    });

    const total = transferCount + directPaymentsCount;
    const pagedRows = rows.slice(skip, skip + limit);

    return paginatedResponse(pagedRows, total, page, limit);
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can record Haji transfers", 403);
    const body = await request.json();
    const cityId = user.cityId!;
    const city = await prisma.city.findUnique({ where: { id: cityId }, include: { country: true } });
    const shouldUseSuperAdminTarget = city?.country?.name === "Pakistan";
    const isAfghanistanCity = city?.country?.name === "Afghanistan";

    if (isAfghanistanCity && body.sourceType && body.sourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city Haji transfers can only use office cash");
    }
    if (isAfghanistanCity && Array.isArray(body.chequePaymentIds) && body.chequePaymentIds.length > 0) {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city Haji transfers cannot use cheques");
    }
    if (isAfghanistanCity && Number(body.cashAmount || 0) > 0 && body.sourceType === "mixed_cash_cheque") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city Haji transfers can only use office cash");
    }

    // Batch mode: one slip can include office cash plus one or more in-hand cheques.
    if (
      body.sourceType === "mixed_cash_cheque" ||
      (Array.isArray(body.chequePaymentIds) && body.chequePaymentIds.length > 0) ||
      (body.sourceType === "mixed_cash_cheque" && Number(body.cashAmount || 0) > 0)
    ) {
      const transferDate = body.transferDate;
      const detail = typeof body.detail === "string" ? body.detail.trim() : "";
      const transferredTo = shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : (typeof body.transferredTo === "string" ? body.transferredTo.trim() : null);
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

      const createdTransfers = await prisma.$transaction(async (tx) => {
        const created: any[] = [];
        const chequePayments: any[] = [];

        for (const chequePaymentId of chequePaymentIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${32003}, ${chequePaymentId})`;
        }

        for (const chequePaymentId of chequePaymentIds) {
          const chequePayment = await tx.payment.findUnique({ where: { id: chequePaymentId } });
          if (!chequePayment) throw new Error("CHEQUE_NOT_FOUND");
          if (chequePayment.cityId !== cityId) throw new Error("CHEQUE_FORBIDDEN");
          if ((chequePayment as any).paymentMethod !== "cheque") throw new Error("CHEQUE_NOT_CHEQUE");
          if ((chequePayment as any).chequeStatus !== "in_hand") throw new Error("CHEQUE_NOT_IN_HAND");
          chequePayments.push(chequePayment);
        }

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
          await createAuditLog(user.userId, cityId, "haji_transfers", cashTransfer.id, "create", undefined, {
            lotId,
            amount: Number(cashTransfer.amount),
            transferType: cashTransfer.transferType,
            sourceType: cashTransfer.sourceType,
          }, getClientIP(request), tx);
          await journalHajiTransfer({
            id: cashTransfer.id,
            cityId,
            amount: Number(cashTransfer.amount),
            currencyCode: cashTransfer.currency.code,
            date: cashTransfer.transferDate,
            createdBy: user.userId,
            sourceType: cashTransfer.sourceType,
            bankAccountId: (cashTransfer as any).bankAccountId ?? null,
          }, tx);
          created.push(cashTransfer);
        }

        for (const chequePayment of chequePayments) {
          const claimed = await tx.payment.updateMany({
            where: { id: chequePayment.id, chequeStatus: "in_hand" as any },
            data: { chequeStatus: "sent_to_haji" } as any,
          });
          if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");

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
          await createAuditLog(user.userId, cityId, "haji_transfers", chequeTransfer.id, "create", undefined, {
            lotId,
            amount: Number(chequeTransfer.amount),
            transferType: chequeTransfer.transferType,
            sourceType: chequeTransfer.sourceType,
          }, getClientIP(request), tx);
          await journalHajiTransfer({
            id: chequeTransfer.id,
            cityId,
            amount: Number(chequeTransfer.amount),
            currencyCode: chequeTransfer.currency.code,
            date: chequeTransfer.transferDate,
            createdBy: user.userId,
            sourceType: chequeTransfer.sourceType,
            bankAccountId: (chequeTransfer as any).bankAccountId ?? null,
          }, tx);
          created.push(chequeTransfer);
        }

        return created;
      });

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
    if (shouldUseSuperAdminTarget) transferredTo = PAKISTAN_HAJI_TARGET;

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

    const transfer = await prisma.$transaction(async (tx) => {
      if (sourceType === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${32003}, ${chequePaymentId})`;
        const chequePayment = await tx.payment.findUnique({ where: { id: chequePaymentId } });
        if (!chequePayment) throw new Error("CHEQUE_NOT_FOUND");
        if (chequePayment.cityId !== cityId) throw new Error("CHEQUE_FORBIDDEN");
        if ((chequePayment as any).paymentMethod !== "cheque") throw new Error("CHEQUE_NOT_CHEQUE");
        if ((chequePayment as any).chequeStatus !== "in_hand") throw new Error("CHEQUE_NOT_IN_HAND");
        const claimed = await tx.payment.updateMany({
          where: { id: chequePaymentId, chequeStatus: "in_hand" as any },
          data: { chequeStatus: "sent_to_haji" } as any,
        });
        if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");
      }

      const createdTransfer = await tx.hajiTransfer.create({
        data: {
          cityId, lotId, transferDate: new Date(transferDate), amount, currencyId: resolvedCurrencyId,
          detail, transferType, transferredTo, notes, createdBy: user.userId,
          ...(sourceType !== undefined ? { sourceType } : {}),
          ...(bankAccountId !== undefined ? { bankAccountId } : {}),
          ...(chequePaymentId !== undefined ? { chequePaymentId } : {}),
        } as any,
        include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
      }) as any;

      await createAuditLog(user.userId, cityId, "haji_transfers", createdTransfer.id, "create", undefined, { lotId, amount, transferType, sourceType }, getClientIP(request), tx);
      await journalHajiTransfer({ id: createdTransfer.id, cityId, amount, currencyCode: createdTransfer.currency.code, date: createdTransfer.transferDate, createdBy: user.userId, sourceType: createdTransfer.sourceType, bankAccountId: (createdTransfer as any).bankAccountId ?? null }, tx);
      return createdTransfer;
    });

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
  } catch (error: any) {
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "One or more selected cheques are no longer available", 409);
    return serverError();
  }
});
