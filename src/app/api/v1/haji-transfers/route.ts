import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalHajiTransfer } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createHajiTransferSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { resolveAfghanistanSettlement } from "@/lib/afghanistan-haji-settlement";
import { PAKISTAN_HAJI_TARGET, resolvePakistanDestinationAccount } from "@/lib/pakistan-haji-destination";
import { getHajiTransferAuditStateMap, isAfghanistanHajiSettlementEligible } from "@/lib/haji-transfer-audit";
import { groupHajiTransferSlipRows } from "@/lib/haji-transfer-slip-group";

const HAJI_TRANSFER_SYNC_MODULE = "haji_transfers.create";

function mapTransferRow(t: any, auditById: Record<number, any>) {
  const settlementDestination = t.settlementDestination ?? "standard";
  return {
    id: t.id,
    cityId: t.cityId,
    lotId: t.lotId,
    recordType: "haji_transfer",
    lotNumber: t.lot.lotNumber,
    lotStatus: t.lot.status,
    transferDate: t.transferDate.toISOString().split("T")[0],
    amount: Number(t.amount),
    detail: t.detail,
    referenceNo: t.referenceNo ?? null,
    transferType: t.transferType,
    transferredTo: t.transferredTo,
    sourceType: t.sourceType ?? null,
    chequeCustomerName: t.chequePayment?.customer?.name ?? null,
    settlementDestination,
    intermediaryId: t.intermediaryId ?? null,
    superAdminCashAccountId: t.superAdminCashAccountId ?? null,
    superAdminBankAccountId: t.superAdminBankAccountId ?? null,
    bankAccountId: t.bankAccountId ?? null,
    chequePaymentId: t.chequePaymentId ?? null,
    destinationAccount: t.superAdminBankAccount || t.superAdminCashAccount || null,
    notes: t.notes,
    currency: { id: t.currency.id, code: t.currency.code, symbol: t.currency.symbol },
    createdBy: t.creator,
    hajiAudit: isAfghanistanHajiSettlementEligible({ settlementDestination, sourceType: t.sourceType })
      ? (auditById[t.id] || null)
      : null,
    attachments: (t.attachments || []).map((a: any) => ({
      ...a,
      filePath: a.filePath.split("|||")[0],
    })),
  };
}

function journalInputFromTransfer(transfer: any, createdBy: number) {
  return {
    id: transfer.id,
    cityId: transfer.cityId,
    lotId: transfer.lotId,
    amount: Number(transfer.amount),
    currencyCode: transfer.currency.code,
    date: transfer.transferDate,
    createdBy,
    sourceType: transfer.sourceType ?? null,
    bankAccountId: transfer.bankAccountId ?? null,
    settlementDestination: transfer.settlementDestination ?? "standard",
    intermediaryId: transfer.intermediaryId ?? null,
    superAdminCashAccountId: transfer.superAdminCashAccountId ?? null,
    superAdminBankAccountId: transfer.superAdminBankAccountId ?? null,
  };
}

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);
    const transferTypeQuery = ["direct", "from_in_hand", "customer_direct"].includes(normalizedQuery) ? normalizedQuery : null;
    const sourceTypeQuery = ["cash_office", "bank_transfer", "cheque", "mixed_cash_cheque"].includes(normalizedQuery) ? normalizedQuery : null;
    const paymentMethodQuery = ["cash", "bank_transfer", "cheque", "online"].includes(normalizedQuery) ? normalizedQuery : null;

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
    if (shouldApplySearch) {
      where.OR = [
        { detail: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { transferredTo: { contains: query, mode: "insensitive" } },
        ...(transferTypeQuery ? [{ transferType: transferTypeQuery as any }] : []),
        ...(sourceTypeQuery ? [{ sourceType: sourceTypeQuery as any }] : []),
        { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
        { currency: { code: { contains: query, mode: "insensitive" } } },
        ...(hasNumericQuery ? [{ amount: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
      ];
    }

    const directPaymentsWhere: any = {
      ...(cityId ? { cityId } : {}),
      ...(dateFrom || dateTo
        ? {
            paymentDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
      destination: "haji",
      status: "active",
    };
    if (shouldApplySearch) {
      directPaymentsWhere.OR = [
        { detail: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { manualVoucherNo: { contains: query, mode: "insensitive" } },
        { chequeNumber: { contains: query, mode: "insensitive" } },
        ...(paymentMethodQuery ? [{ paymentMethod: paymentMethodQuery as any }] : []),
        { customer: { name: { contains: query, mode: "insensitive" } } },
        { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
        { currency: { code: { contains: query, mode: "insensitive" } } },
        ...(hasNumericQuery ? [{ amount: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
      ];
    }

    const [transfers, directPayments] = await Promise.all([
      prisma.hajiTransfer.findMany({
        where,
        include: {
          lot: { select: { id: true, lotNumber: true, status: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          chequePayment: {
            select: {
              manualVoucherNo: true,
              customer: { select: { id: true, name: true } },
            },
          },
          superAdminBankAccount: { select: { bankName: true, accountNumber: true } },
          superAdminCashAccount: { select: { bankName: true, accountNumber: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { transferDate: "desc" },
      }),
      prisma.payment.findMany({
        where: directPaymentsWhere,
        include: {
          customer: { select: { id: true, name: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
        },
        orderBy: { paymentDate: "desc" },
      }),
    ]);

    const auditById = await getHajiTransferAuditStateMap(transfers.map((t) => t.id));

    const transferRows = groupHajiTransferSlipRows(transfers.map((t) => mapTransferRow(t, auditById)));

    const rows = [
      ...transferRows,
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
        referenceNo: p.manualVoucherNo ?? null,
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
      const dateA = a.transferDate ?? "";
      const dateB = b.transferDate ?? "";
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      return b.id - a.id;
    });

    const total = rows.length;
    const pagedRows = rows.slice(skip, skip + limit);

    return paginatedResponse(pagedRows, total, page, limit);
  } catch (error) {
    console.error("Haji transfers GET:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can record Haji transfers", 403);
    const syncMeta = getSyncRequestMeta(request);
    const body = await request.json();
    const cityId = user.cityId!;
    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: HAJI_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingTransfer = await prisma.hajiTransfer.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
        });
        if (existingTransfer) {
          return successResponse({
            id: existingTransfer.id,
            lotNumber: existingTransfer.lot.lotNumber,
            transferDate: existingTransfer.transferDate.toISOString().split("T")[0],
            amount: Number(existingTransfer.amount),
            detail: existingTransfer.detail,
            transferType: existingTransfer.transferType,
            sourceType: existingTransfer.sourceType ?? null,
            bankAccountId: existingTransfer.bankAccountId ?? null,
            chequePaymentId: existingTransfer.chequePaymentId ?? null,
            currency: { id: existingTransfer.currency.id, code: existingTransfer.currency.code, symbol: existingTransfer.currency.symbol },
            createdBy: existingTransfer.creator,
          }, "Haji transfer already synced");
        }
        return successResponse({ id: existingSync.entityId }, "Haji transfer already synced");
      }
    }

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

    if (isAfghanistanCity && (
      body.sourceType === "mixed_cash_cheque" ||
      (Array.isArray(body.chequePaymentIds) && body.chequePaymentIds.length > 0) ||
      body.sourceType === "cheque" ||
      body.sourceType === "bank_transfer"
    )) {
      return errorResponse("VALIDATION_ERROR", "Afghanistan settlements use office cash only");
    }

    // Batch mode: one slip can include office cash plus one or more in-hand cheques.
    if (
      body.sourceType === "mixed_cash_cheque" ||
      (Array.isArray(body.chequePaymentIds) && body.chequePaymentIds.length > 0) ||
      (body.sourceType === "mixed_cash_cheque" && Number(body.cashAmount || 0) > 0)
    ) {
      const transferDate = body.transferDate;
      const detail = typeof body.detail === "string" ? body.detail.trim() : "";
      const transferredTo = shouldUseSuperAdminTarget
        ? (typeof body.transferredTo === "string" && body.transferredTo.trim()
          ? body.transferredTo.trim()
          : PAKISTAN_HAJI_TARGET)
        : (typeof body.transferredTo === "string" ? body.transferredTo.trim() : null);
      const notes = typeof body.notes === "string" ? body.notes : undefined;
      const referenceNo = typeof body.referenceNo === "string" && body.referenceNo.trim() ? body.referenceNo.trim() : undefined;
      const cashAmount = Number(body.cashAmount || 0);
      const currencyId = body.currencyId ? parseInt(body.currencyId) : undefined;
      const lotIdInput = body.lotId ? parseInt(body.lotId) : undefined;
      const pakistanDestination = shouldUseSuperAdminTarget
        ? await resolvePakistanDestinationAccount(body.superAdminDestinationAccountId, transferredTo)
        : {};
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
        where: { id: lotId, status: "ongoing", lotCityDistributions: { some: { cityId } } },
      });
      if (!lot) return errorResponse("VALIDATION_ERROR", "Ongoing lot not found or not distributed to your city");

      if (cashAmount > 0) {
        const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
        if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");
      }

      const createdTransfers = await prisma.$transaction(async (tx) => {
        const created: any[] = [];
        const chequePayments: any[] = [];

        for (const chequePaymentId of chequePaymentIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(32003, ${chequePaymentId}::int)`;
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
              ...(referenceNo ? { referenceNo } : {}),
              sourceType: "cash_office",
              ...pakistanDestination,
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
            settlementDestination: (cashTransfer as any).settlementDestination ?? "standard",
            superAdminCashAccountId: (cashTransfer as any).superAdminCashAccountId ?? null,
            superAdminBankAccountId: (cashTransfer as any).superAdminBankAccountId ?? null,
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
              ...(referenceNo ? { referenceNo } : {}),
              sourceType: "cheque",
              chequePaymentId: chequePayment.id,
              ...pakistanDestination,
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
            settlementDestination: (chequeTransfer as any).settlementDestination ?? "standard",
            superAdminCashAccountId: (chequeTransfer as any).superAdminCashAccountId ?? null,
            superAdminBankAccountId: (chequeTransfer as any).superAdminBankAccountId ?? null,
          }, tx);
          created.push(chequeTransfer);
        }

        if (syncMeta && created.length > 0) {
          await tx.syncRequest.create({
            data: {
              cityId,
              module: HAJI_TRANSFER_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "haji_transfers",
              entityId: created[0].id,
              createdBy: user.userId,
            },
          });
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
    let { lotId, transferDate, amount, currencyId, detail, referenceNo, transferType, transferredTo, notes } = parsed.data;
    if (shouldUseSuperAdminTarget) {
      transferredTo = transferredTo?.trim() || PAKISTAN_HAJI_TARGET;
    }
    const resolvedReferenceNo = referenceNo?.trim() || (typeof body.referenceNo === "string" && body.referenceNo.trim() ? body.referenceNo.trim() : undefined);

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
      where: { id: lotId, status: "ongoing", lotCityDistributions: { some: { cityId } } },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Ongoing lot not found or not distributed to your city");

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");
    const resolvedCurrencyId = currencyId ?? cityCurrency.currencyId;

    let settlementDestination: "standard" | "intermediary" | "super_admin_cash" = "standard";
    let intermediaryId: number | null = null;
    let superAdminCashAccountId: number | null = null;
    let superAdminBankAccountId: number | null = null;

    if (shouldUseSuperAdminTarget) {
      const pakistanDestination = await resolvePakistanDestinationAccount(
        body.superAdminDestinationAccountId,
        transferredTo,
      );
      if (pakistanDestination.settlementDestination === "super_admin_cash") {
        settlementDestination = "super_admin_cash";
        superAdminCashAccountId = pakistanDestination.superAdminCashAccountId ?? null;
      }
      if (pakistanDestination.superAdminBankAccountId) {
        superAdminBankAccountId = pakistanDestination.superAdminBankAccountId;
      }
    }

    if (isAfghanistanCity) {
      sourceType = "cash_office";
      transferType = "from_in_hand";
      const settlement = await resolveAfghanistanSettlement(prisma, {
        settlementDestination: body.settlementDestination,
        intermediaryId: body.intermediaryId,
        superAdminCashAccountId: body.superAdminCashAccountId,
        currencyId: resolvedCurrencyId,
      });
      if (!settlement.ok) return errorResponse("VALIDATION_ERROR", settlement.message);
      settlementDestination = settlement.data.settlementDestination;
      intermediaryId = settlement.data.intermediaryId;
      superAdminCashAccountId = settlement.data.superAdminCashAccountId;
      transferredTo = settlement.data.transferredTo;
    }

    const transfer = await prisma.$transaction(async (tx) => {
      if (sourceType === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(32003, ${chequePaymentId}::int)`;
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
        amount = Number(chequePayment.amount);
      }

      const createdTransfer = await tx.hajiTransfer.create({
        data: {
          cityId, lotId, transferDate: new Date(transferDate), amount, currencyId: resolvedCurrencyId,
          detail, transferType, transferredTo, notes, createdBy: user.userId,
          ...(resolvedReferenceNo ? { referenceNo: resolvedReferenceNo } : {}),
          settlementDestination,
          intermediaryId,
          superAdminCashAccountId,
          superAdminBankAccountId,
          ...(sourceType !== undefined ? { sourceType } : {}),
          ...(bankAccountId !== undefined ? { bankAccountId } : {}),
          ...(chequePaymentId !== undefined ? { chequePaymentId } : {}),
        } as any,
        include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
      }) as any;

      await createAuditLog(user.userId, cityId, "haji_transfers", createdTransfer.id, "create", undefined, { lotId, amount, transferType, sourceType, settlementDestination }, getClientIP(request), tx);
      await journalHajiTransfer(journalInputFromTransfer(createdTransfer, user.userId), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: HAJI_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "haji_transfers",
            entityId: createdTransfer.id,
            createdBy: user.userId,
          },
        });
      }
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
    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.role === "city_admin" ? user.cityId! : null;
    if (syncMeta && cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: HAJI_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Haji transfer already synced");
      }
    }
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "One or more selected cheques are no longer available", 409);
    return serverError();
  }
});
